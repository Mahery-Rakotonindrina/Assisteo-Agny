import { Redis } from "@upstash/redis";

// Free trial on the server's own AI key: a few analyses per install, then the
// user must add their own key. Counted server-side so clearing the app's data
// doesn't reset it, with a per-IP ceiling against scripted abuse.
//
// The limits are runtime settings (editable from /admin without redeploying);
// the environment only provides their defaults.

export type TrialConfig = {
  /** Free scans per install on the server's key. */
  limit: number;
  /** Ceiling per IP over 30 days, against repeated reinstalls. */
  ipLimit: number;
  /** Follow-up questions per install per day on the server's key. */
  askLimit: number;
};

const defaults: TrialConfig = {
  limit: Number(process.env.TRIAL_SCANS ?? 7),
  ipLimit: Number(process.env.TRIAL_SCANS_PER_IP ?? 20),
  askLimit: Number(process.env.ASK_PER_DAY ?? 20),
};
const IP_WINDOW_S = 30 * 24 * 3600;
const CONFIG_KEY = "config:trial";

type Store = {
  incr(key: string, ttlSeconds?: number): Promise<number>;
  decr(key: string): Promise<void>;
  get(key: string): Promise<number>;
  readConfig(): Promise<Partial<TrialConfig> | null>;
  writeConfig(config: TrialConfig): Promise<void>;
};

function redisStore(redis: Redis): Store {
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
    readConfig: () => redis.get<Partial<TrialConfig>>(CONFIG_KEY),
    async writeConfig(config) {
      await redis.set(CONFIG_KEY, config);
    },
  };
}

// Fallback without Redis: per server instance and lost on restart, so only
// a soft limit on serverless hosts. Good enough for local development.
function memoryStore(): Store {
  const values = new Map<string, number>();
  let config: TrialConfig | null = null;
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
    readConfig: async () => config,
    async writeConfig(next) {
      config = next;
    },
  };
}

const hasRedis = Boolean(
  (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ||
    (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN),
);

const store: Store = hasRedis ? redisStore(Redis.fromEnv()) : memoryStore();

if (!hasRedis && process.env.VERCEL) {
  console.warn("[trial] No Upstash Redis configured: trial counts and settings reset on cold starts.");
}

/** False when counts and settings only live in memory (no Redis configured). */
export const trialIsDurable = hasRedis;

export async function getTrialConfig(): Promise<TrialConfig> {
  const stored = await store.readConfig().catch(() => null);
  return { ...defaults, ...stored };
}

export async function setTrialConfig(config: TrialConfig) {
  await store.writeConfig(config);
}

const installKey = (installId: string) => `trial:install:${installId}`;
const ipKey = (ip: string) => `trial:ip:${ip}`;

export async function getTrialUsage(installId: string) {
  const [{ limit }, used] = await Promise.all([getTrialConfig(), store.get(installKey(installId))]);
  return { limit, used: Math.min(limit, used) };
}

/**
 * Books one trial scan before calling the AI. Returns the usage after booking,
 * or null when the trial is over. Call releaseTrialScan if the analysis fails.
 */
export async function reserveTrialScan(installId: string, ip: string) {
  const { limit, ipLimit } = await getTrialConfig();
  const used = await store.incr(installKey(installId));
  if (used > limit) {
    await store.decr(installKey(installId));
    return null;
  }
  const ipUsed = await store.incr(ipKey(ip), IP_WINDOW_S);
  if (ipUsed > ipLimit) {
    await Promise.all([store.decr(installKey(installId)), store.decr(ipKey(ip))]);
    return null;
  }
  return { used, limit };
}

// Questions about a scan: a daily allowance per install, reset at midnight UTC.
const askKey = (installId: string) => `ask:${installId}:${new Date().toISOString().slice(0, 10)}`;

/** Books one follow-up question; null when today's allowance is used up. */
export async function reserveAsk(installId: string) {
  const { askLimit } = await getTrialConfig();
  const used = await store.incr(askKey(installId), 2 * 24 * 3600);
  if (used > askLimit) {
    await store.decr(askKey(installId));
    return null;
  }
  return { used, limit: askLimit };
}

export async function releaseAsk(installId: string) {
  await store.decr(askKey(installId));
}

export async function releaseTrialScan(installId: string, ip: string) {
  await Promise.all([store.decr(installKey(installId)), store.decr(ipKey(ip))]);
}
