import type { Redis } from "@upstash/redis";
import { redis } from "./redis";

// Free trial on the server's own AI key: a few analyses per install, then the
// user must add their own key. Counted server-side so clearing the app's data
// doesn't reset it, with a per-IP ceiling against scripted abuse. Signed-in
// users are also counted per account, so a new device doesn't bring the
// trial back.
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
  /**
   * All requests (scans + questions) on the server's key per day, for every
   * user together. Keeps the shared AI quota or bill under control. 0 = no cap.
   */
  dailyLimit: number;
};

const defaults: TrialConfig = {
  limit: Number(process.env.TRIAL_SCANS ?? 7),
  ipLimit: Number(process.env.TRIAL_SCANS_PER_IP ?? 20),
  askLimit: Number(process.env.ASK_PER_DAY ?? 20),
  dailyLimit: Number(process.env.SERVER_DAILY_LIMIT ?? 200),
};
const IP_WINDOW_S = 30 * 24 * 3600;
const CONFIG_KEY = "config:trial";

type Store = {
  incr(key: string, ttlSeconds?: number): Promise<number>;
  incrBy(key: string, amount: number): Promise<number>;
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
    incrBy: (key, amount) => redis.incrby(key, amount),
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
    async incrBy(key, amount) {
      const value = (values.get(key) ?? 0) + amount;
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

const hasRedis = redis !== null;

const store: Store = redis ? redisStore(redis) : memoryStore();

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
const userKey = (userId: string) => `trial:user:${userId}`;

/** Who is scanning: always an install, plus the account when signed in. */
export type TrialSubject = { installId: string; userId?: string | null };

export async function getTrialUsage({ installId, userId }: TrialSubject) {
  const [{ limit }, installUsed, userUsed] = await Promise.all([
    getTrialConfig(),
    store.get(installKey(installId)),
    userId ? store.get(userKey(userId)) : 0,
  ]);
  return { limit, used: Math.min(limit, Math.max(installUsed, userUsed)) };
}

/**
 * Books one trial scan before calling the AI. Returns the usage after booking,
 * or null when the trial is over. Call releaseTrialScan if the analysis fails.
 */
export async function reserveTrialScan({ installId, userId }: TrialSubject, ip: string) {
  const { limit, ipLimit } = await getTrialConfig();
  const used = await store.incr(installKey(installId));
  if (used > limit) {
    await store.decr(installKey(installId));
    return null;
  }
  let accountUsed = 0;
  if (userId) {
    accountUsed = await store.incr(userKey(userId));
    // Scans made on this device before signing in count for the account too.
    if (accountUsed < used) accountUsed = await store.incrBy(userKey(userId), used - accountUsed);
    if (accountUsed > limit) {
      await Promise.all([store.decr(installKey(installId)), store.decr(userKey(userId))]);
      return null;
    }
  }
  const ipUsed = await store.incr(ipKey(ip), IP_WINDOW_S);
  if (ipUsed > ipLimit) {
    await Promise.all([store.decr(installKey(installId)), store.decr(ipKey(ip)), userId ? store.decr(userKey(userId)) : null]);
    return null;
  }
  return { used: Math.max(used, accountUsed), limit };
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

export async function releaseTrialScan({ installId, userId }: TrialSubject, ip: string) {
  await Promise.all([store.decr(installKey(installId)), store.decr(ipKey(ip)), userId ? store.decr(userKey(userId)) : null]);
}

// Every call on the server's key, all users together, reset at midnight UTC.
const dayKey = () => `server:day:${new Date().toISOString().slice(0, 10)}`;

/** Requests made on the server's key today. */
export async function getServerUsage() {
  const [{ dailyLimit }, used] = await Promise.all([getTrialConfig(), store.get(dayKey())]);
  return { dailyLimit, used };
}

/** Books one call on the server's AI key; false once today's global cap is reached. */
export async function reserveServerCall() {
  const { dailyLimit } = await getTrialConfig();
  const used = await store.incr(dayKey(), 2 * 24 * 3600);
  if (dailyLimit > 0 && used > dailyLimit) {
    await store.decr(dayKey());
    return false;
  }
  return true;
}

export async function releaseServerCall() {
  await store.decr(dayKey());
}

/** Questions asked today by an install on the server's key. */
export async function getAskUsage(installId: string) {
  return store.get(askKey(installId));
}

// ---- Subscribers ---------------------------------------------------------------
// Counted per account: scans per calendar month, questions per day (UTC).

const monthScansKey = (userId: string) => `plan:scans:${userId}:${new Date().toISOString().slice(0, 7)}`;
const dayAskKey = (userId: string) => `plan:ask:${userId}:${new Date().toISOString().slice(0, 10)}`;
const monthDeepKey = (userId: string) => `plan:deep:${userId}:${new Date().toISOString().slice(0, 7)}`;

export async function getPlanUsage(userId: string) {
  const [scans, questionsToday, deep] = await Promise.all([store.get(monthScansKey(userId)), store.get(dayAskKey(userId)), store.get(monthDeepKey(userId))]);
  return { scans, questionsToday, deep };
}

/** Books one use against a limit (0 = none); null once the limit is reached. */
async function reserveUse(key: string, limit: number, ttlSeconds: number) {
  const used = await store.incr(key, ttlSeconds);
  if (limit > 0 && used > limit) {
    await store.decr(key);
    return null;
  }
  return { used, limit };
}

export const reservePlanScan = (userId: string, limit: number) => reserveUse(monthScansKey(userId), limit, 40 * 24 * 3600);
export const releasePlanScan = (userId: string) => store.decr(monthScansKey(userId));
export const reservePlanAsk = (userId: string, limit: number) => reserveUse(dayAskKey(userId), limit, 2 * 24 * 3600);
export const releasePlanAsk = (userId: string) => store.decr(dayAskKey(userId));
export const reservePlanDeep = (userId: string, limit: number) => reserveUse(monthDeepKey(userId), limit, 40 * 24 * 3600);
export const releasePlanDeep = (userId: string) => store.decr(monthDeepKey(userId));

/** Books one call on the server's key for a subscriber: counted, never refused by the daily cap. */
export async function countServerCall() {
  await store.incr(dayKey(), 2 * 24 * 3600);
}
