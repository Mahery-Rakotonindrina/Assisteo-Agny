import { Redis } from "@upstash/redis";

// Shared Upstash Redis client (Vercel Marketplace sets the KV_* variables),
// or null when none is configured: callers fall back to process memory.

const configured = Boolean(
  (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ||
    (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN),
);

export const redis: Redis | null = configured ? Redis.fromEnv() : null;
