// Fixed-window, in-memory limiter. Good enough for a single instance / demo;
// swap for a shared store (Upstash, Redis) when running several instances.

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const current = windows.get(key);

  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    if (windows.size > 5000) prune(now);
    return { ok: true, retryAfterS: 0 };
  }

  current.count += 1;
  if (current.count > limit) {
    return { ok: false, retryAfterS: Math.ceil((current.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfterS: 0 };
}

function prune(now: number) {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}
