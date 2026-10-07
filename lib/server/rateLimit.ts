import { redis } from "./redis";

// Fixed-window limiter shared by every serverless instance through Redis.
// Falls back to process memory without Redis (local dev) or if Redis fails,
// so an outage never blocks the app.

export type RateLimitResult = { ok: boolean; retryAfterS: number };

type Window = { count: number; resetAt: number };
const windows = new Map<string, Window>();

function memoryLimit(key: string, limit: number, windowMs: number, now: number): RateLimitResult {
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    if (windows.size > 5000) prune(now);
    return { ok: true, retryAfterS: 0 };
  }
  current.count += 1;
  return current.count > limit ? { ok: false, retryAfterS: Math.ceil((current.resetAt - now) / 1000) } : { ok: true, retryAfterS: 0 };
}

function prune(now: number) {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

export async function rateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const now = Date.now();
  if (!redis) return memoryLimit(key, limit, windowMs, now);

  const bucket = Math.floor(now / windowMs);
  const resetAt = (bucket + 1) * windowMs;
  const redisKey = `rl:${key}:${bucket}`;
  try {
    const [count] = await redis.pipeline().incr(redisKey).pexpire(redisKey, windowMs).exec<[number, number]>();
    return count > limit ? { ok: false, retryAfterS: Math.ceil((resetAt - now) / 1000) } : { ok: true, retryAfterS: 0 };
  } catch {
    return memoryLimit(key, limit, windowMs, now);
  }
}
