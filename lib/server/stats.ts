import { createHash } from "node:crypto";
import { redis } from "./redis";

// Anonymous, aggregated usage counters for the admin dashboard: one Redis
// hash per day (analyses by mode and category, questions, errors, feedback)
// plus a HyperLogLog of active devices, which estimates a count without
// storing any device id. No photos, no content, no accounts. Kept 120 days.

const TTL_S = 120 * 24 * 3600;
const RECENT_FEEDBACK_KEY = "stats:feedback:recent";
const RECENT_FEEDBACK_MAX = 200;

const dayOf = (at = Date.now()) => new Date(at).toISOString().slice(0, 10);
const countersKey = (day: string) => `stats:${day}`;
const devicesKey = (day: string) => `stats:${day}:devices`;

export type StatsEvent =
  | { type: "scan"; mode: string; category: string; ownKey: boolean; durationMs: number }
  | { type: "question"; ownKey: boolean }
  | { type: "error"; route: "analyze" | "ask"; code: string }
  | { type: "feedback"; vote: "up" | "down"; category: string };

export type FeedbackRecord = {
  at: number;
  vote: "up" | "down";
  reason?: string;
  category: string;
  mode: string;
  model: string;
  confidence: number;
  title: string;
};

export type DayStats = {
  date: string;
  devices: number;
  counters: Record<string, number>;
};

function fieldsFor(event: StatsEvent): Record<string, number> {
  switch (event.type) {
    case "scan":
      return {
        scans: 1,
        [`scans:mode:${event.mode}`]: 1,
        [`scans:category:${event.category}`]: 1,
        [event.ownKey ? "scans:own" : "scans:server"]: 1,
        "scans:ms": Math.round(event.durationMs),
      };
    case "question":
      return { questions: 1, [event.ownKey ? "questions:own" : "questions:server"]: 1 };
    case "error":
      return { [`errors:${event.route}:${event.code}`]: 1 };
    case "feedback":
      return { [`feedback:${event.vote}`]: 1, [`feedback:${event.vote}:${event.category}`]: 1 };
  }
}

// Without Redis (local development): kept in memory.
const memory = new Map<string, { counters: Record<string, number>; devices: Set<string> }>();
const memoryFeedback: FeedbackRecord[] = [];

/** Records one event. Never throws: statistics must not break a request. */
export async function track(event: StatsEvent, installId?: string | null) {
  const day = dayOf();
  const fields = fieldsFor(event);
  const device = installId ? createHash("sha256").update(installId).digest("hex").slice(0, 32) : null;
  try {
    if (!redis) {
      const entry = memory.get(day) ?? { counters: {}, devices: new Set<string>() };
      for (const [field, amount] of Object.entries(fields)) entry.counters[field] = (entry.counters[field] ?? 0) + amount;
      if (device) entry.devices.add(device);
      memory.set(day, entry);
      return;
    }
    const pipeline = redis.pipeline();
    for (const [field, amount] of Object.entries(fields)) pipeline.hincrby(countersKey(day), field, amount);
    pipeline.expire(countersKey(day), TTL_S);
    if (device) {
      pipeline.pfadd(devicesKey(day), device);
      pipeline.expire(devicesKey(day), TTL_S);
    }
    await pipeline.exec();
  } catch {
    // Ignored on purpose.
  }
}

export async function recordFeedback(record: FeedbackRecord) {
  try {
    if (!redis) {
      memoryFeedback.unshift(record);
      memoryFeedback.length = Math.min(memoryFeedback.length, RECENT_FEEDBACK_MAX);
      return;
    }
    await redis.pipeline().lpush(RECENT_FEEDBACK_KEY, JSON.stringify(record)).ltrim(RECENT_FEEDBACK_KEY, 0, RECENT_FEEDBACK_MAX - 1).exec();
  } catch {
    // Ignored on purpose.
  }
}

/** The last `days` days, most recent first. */
export async function getStats(days: number): Promise<DayStats[]> {
  const dates = Array.from({ length: days }, (_, index) => dayOf(Date.now() - index * 86_400_000));
  if (!redis) {
    return dates.map((date) => ({
      date,
      devices: memory.get(date)?.devices.size ?? 0,
      counters: { ...(memory.get(date)?.counters ?? {}) },
    }));
  }
  const pipeline = redis.pipeline();
  for (const date of dates) {
    pipeline.hgetall(countersKey(date));
    pipeline.pfcount(devicesKey(date));
  }
  const results = await pipeline.exec<unknown[]>();
  return dates.map((date, index) => {
    const raw = (results[index * 2] ?? {}) as Record<string, string | number> | null;
    const counters = Object.fromEntries(Object.entries(raw ?? {}).map(([field, value]) => [field, Number(value)]));
    return { date, devices: Number(results[index * 2 + 1] ?? 0), counters };
  });
}

export async function getRecentFeedback(limit = 30): Promise<FeedbackRecord[]> {
  if (!redis) return memoryFeedback.slice(0, limit);
  const items = await redis.lrange<FeedbackRecord | string>(RECENT_FEEDBACK_KEY, 0, limit - 1);
  // Upstash decodes JSON automatically; tolerate raw strings too.
  return items.map((item) => (typeof item === "string" ? (JSON.parse(item) as FeedbackRecord) : item));
}

/** Distinct devices over the last `days` days (union of the daily estimates). */
export async function getUniqueDevices(days: number): Promise<number> {
  const dates = Array.from({ length: days }, (_, index) => dayOf(Date.now() - index * 86_400_000));
  if (!redis) {
    const all = new Set<string>();
    for (const date of dates) memory.get(date)?.devices.forEach((device) => all.add(device));
    return all.size;
  }
  return redis.pfcount(...(dates.map(devicesKey) as [string, ...string[]]));
}
