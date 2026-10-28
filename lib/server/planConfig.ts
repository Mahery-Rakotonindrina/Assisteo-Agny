import { z } from "zod";
import { defaultYearPrice } from "@/lib/offers";
import { defaultPlansConfig, featureModes, planFeatures, planIds, soldPlans, withFeatureDefaults, type FeatureSettings, type PlanOffer, type PlansConfig } from "@/lib/plans";
import { redis } from "./redis";

// Prices, limits and payment instructions of the plans, editable from /admin.

const Offer = z.object({
  priceMga: z.number().int().min(0).max(10_000_000),
  yearPriceMga: z.number().int().min(0).max(100_000_000),
  scans: z.number().int().min(0).max(100_000),
  questionsPerDay: z.number().int().min(0).max(10_000),
  parcels: z.number().int().min(0).max(10_000),
  deepPerMonth: z.number().int().min(0).max(10_000),
});

const Feature = z.enum(planFeatures);
/** At most this many testers per feature. */
export const MAX_TESTERS = 200;

const Status = z.object({
  mode: z.enum(featureModes),
  testers: z.array(z.string().trim().toLowerCase().max(254).pipe(z.email())).max(MAX_TESTERS),
});

/** The features of each plan and the state of each feature (Admin → Offers). */
export const FeatureSettingsSchema = z.object({
  features: z.object(Object.fromEntries(planIds.map((plan) => [plan, z.array(Feature).max(planFeatures.length)])) as Record<(typeof planIds)[number], z.ZodArray<typeof Feature>>),
  featureStatus: z.object(Object.fromEntries(planFeatures.map((feature) => [feature, Status])) as Record<(typeof planFeatures)[number], typeof Status>),
});

/** Prices, limits and payment; the features are saved apart (FeatureSettingsSchema). */
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

/**
 * A stored offer over the defaults. Saved before the yearly price existed,
 * it gets ten times its own monthly price (two months offered).
 */
export function mergeOffer(plan: (typeof soldPlans)[number], stored: Partial<PlanOffer> | undefined): PlanOffer {
  const offer = { ...defaultPlansConfig.offers[plan], ...stored };
  return stored?.yearPriceMga === undefined && stored?.priceMga !== undefined ? { ...offer, yearPriceMga: defaultYearPrice(offer.priceMga) } : offer;
}

export async function getPlansConfig(): Promise<PlansConfig> {
  const stored = redis ? await redis.get<Partial<PlansConfig>>(KEY).catch(() => null) : memory;
  return {
    ...defaultPlansConfig,
    ...stored,
    // Saved before the features could be set, or before a feature existed: the built-in ladder.
    ...withFeatureDefaults(stored),
    // Per plan, so a setting added later gets its default.
    offers: Object.fromEntries(soldPlans.map((plan) => [plan, mergeOffer(plan, stored?.offers?.[plan])])) as PlansConfig["offers"],
    payment: { ...defaultPlansConfig.payment, ...stored?.payment },
  };
}

/** Replaces the features of each plan and their state, the rest kept. */
export async function setFeatureSettings(settings: FeatureSettings) {
  // Through the defaults: known features only, each once.
  const config: PlansConfig = { ...(await getPlansConfig()), ...withFeatureDefaults(settings) };
  await setPlansConfig(config);
  return config;
}

export async function setPlansConfig(config: PlansConfig) {
  if (redis) await redis.set(KEY, config);
  else memory = config;
}
