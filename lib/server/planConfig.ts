import { z } from "zod";
import { defaultPlansConfig, soldPlans, type PlansConfig } from "@/lib/plans";
import { redis } from "./redis";

// Prices, limits and payment instructions of the plans, editable from /admin.

const Offer = z.object({
  priceMga: z.number().int().min(0).max(10_000_000),
  scans: z.number().int().min(0).max(100_000),
  questionsPerDay: z.number().int().min(0).max(10_000),
  parcels: z.number().int().min(0).max(10_000),
});

export const PlansConfigSchema = z.object({
  offers: z.object(Object.fromEntries(soldPlans.map((plan) => [plan, Offer])) as Record<(typeof soldPlans)[number], typeof Offer>),
  freeParcels: z.number().int().min(0).max(10_000),
  payment: z.object({
    instructions: z.string().trim().max(1500),
    // A phone number or a link (WhatsApp, Messenger…).
    contact: z.string().trim().max(200),
  }),
});

const KEY = "config:plans";
let memory: PlansConfig | null = null;

export async function getPlansConfig(): Promise<PlansConfig> {
  const stored = redis ? await redis.get<Partial<PlansConfig>>(KEY).catch(() => null) : memory;
  return {
    ...defaultPlansConfig,
    ...stored,
    offers: { ...defaultPlansConfig.offers, ...stored?.offers },
    payment: { ...defaultPlansConfig.payment, ...stored?.payment },
  };
}

export async function setPlansConfig(config: PlansConfig) {
  if (redis) await redis.set(KEY, config);
  else memory = config;
}
