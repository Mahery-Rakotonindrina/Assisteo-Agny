import { z } from "zod";
import { defaultAiPrices, type AiPrice } from "@/lib/aiCost";
import { redis } from "./redis";

// The AI prices used to compute what the server's key costs, editable from /admin.

export const AiPricesSchema = z
  .array(
    z.object({
      match: z.string().trim().min(1).max(60),
      inputUsd: z.number().min(0).max(1000),
      outputUsd: z.number().min(0).max(1000),
    }),
  )
  .max(30);

const KEY = "config:ai-prices";
let memory: AiPrice[] | null = null;

export async function getAiPrices(): Promise<AiPrice[]> {
  const stored = redis ? await redis.get<AiPrice[]>(KEY).catch(() => null) : memory;
  return stored ?? defaultAiPrices;
}

export async function setAiPrices(prices: AiPrice[]) {
  if (redis) await redis.set(KEY, prices);
  else memory = prices;
}
