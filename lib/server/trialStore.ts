import { Redis } from "@upstash/redis";

// Free trial on the server's own AI key: a few analyses per install, then the
// user must add their own key. Counted server-side so clearing the app's data
// doesn't reset it, with a per-IP ceiling against scripted abuse.

export const TRIAL_LIMIT = Number(process.env.TRIAL_SCANS ?? 3);
const IP_LIMIT = Number(process.env.TRIAL_SCANS_PER_IP ?? 15);
const IP_WINDOW_S = 30 * 24 * 3600;

type Counter = {
  incr(key: string, ttlSeconds?: number): Promise<number>;
  decr(key: string): Promise<void>;
  get(key: string): Promise<number>;
};

function redisCounter(redis: Redis): Counter {
  return {
    async incr(key, ttlSeconds) {
      const value = await redis.incr(key);
      if (ttlSeconds && value === 1) await redis.expire(key, ttlSeconds);
      return value;
    },
    async decr(key) {
      await redis.decr(key);
    },
    async get(key) {
      return Number((await redis.get<number>(key)) ?? 0);
    },
  };
}

// Fallback without Redis: per server instance and lost on restart, so only
// a soft limit on serverless hosts. Good enough for local development.
function memoryCounter(): Counter {
  const values = new Map<string, number>();
  return {
    async incr(key) {
      const value = (values.get(key) ?? 0) + 1;
      values.set(key, value);
      return value;
    },
    async decr(key) {
      values.set(key, Math.max(0, (values.get(key) ?? 0) - 1));
    },
    async get(key) {
      return values.get(key) ?? 0;
    },
  };
}

const hasRedis = Boolean(
  (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ||
    (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN),
);

const counter: Counter = hasRedis ? redisCounter(Redis.fromEnv()) : memoryCounter();

if (!hasRedis && process.env.VERCEL) {
  console.warn("[trial] No Upstash Redis configured: trial counts are per instance and reset on cold starts.");
}

/** False when counts only live in memory (no Redis configured). */
export const trialIsDurable = hasRedis;

const installKey = (installId: string) => `trial:install:${installId}`;
const ipKey = (ip: string) => `trial:ip:${ip}`;

export async function getTrialUsed(installId: string) {
  return Math.min(TRIAL_LIMIT, await counter.get(installKey(installId)));
}

/**
 * Books one trial scan before calling the AI. Returns the scans used so far,
 * or null when the trial is over. Call releaseTrialScan if the analysis fails.
 */
export async function reserveTrialScan(installId: string, ip: string): Promise<number | null> {
  const used = await counter.incr(installKey(installId));
  if (used > TRIAL_LIMIT) {
    await counter.decr(installKey(installId));
    return null;
  }
  const ipUsed = await counter.incr(ipKey(ip), IP_WINDOW_S);
  if (ipUsed > IP_LIMIT) {
    await Promise.all([counter.decr(installKey(installId)), counter.decr(ipKey(ip))]);
    return null;
  }
  return used;
}

export async function releaseTrialScan(installId: string, ip: string) {
  await Promise.all([counter.decr(installKey(installId)), counter.decr(ipKey(ip))]);
}
