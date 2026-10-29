import type { NextApiRequest } from "next";
import { effectiveFeatures, runningGrants, withDeepFallback, withQuotas, type ActivePlan, type FeatureGrant, type PlanFeature, type PlanLimits, type PlansConfig, type QuotaOverrides } from "@/lib/plans";
import { currentGrantsForEmail } from "./featureGrants";
import { getPlansConfig } from "./planConfig";
import { reportError } from "./reportError";
import { accessForEmail, type Access } from "./subscriptions";
import { verifyAccount } from "./supabaseAdmin";
import { getTrialConfig } from "./trialStore";

export type ResolvedPlan = {
  account: { id: string; email: string | null } | null;
  current: ActivePlan;
  /** What the account may use (the Admin settings applied): every server check goes by it. */
  features: ReadonlySet<PlanFeature>;
  /** The running subscription's own limits (pass them to `limitsFor`); null: the plan's. */
  quotas: QuotaOverrides | null;
  /** The features offered to the account for a while, running now, each with its end. */
  grants: Array<{ feature: PlanFeature; endsAt: string }>;
};

/**
 * The signed-in account (if any), its plan right now and what it may use.
 * Called on every request: the subscription (with its own settings) and the
 * offered features are read side by side, so it costs no more time than the
 * subscription alone did; before migration 0011 both fall back at no cost.
 */
export async function resolvePlan(req: NextApiRequest, config?: PlansConfig): Promise<ResolvedPlan> {
  const [account, plans] = await Promise.all([verifyAccount(req).catch(() => null), config ?? getPlansConfig()]);
  const email = account?.email ?? null;
  const [access, grants] = await Promise.all([currentAccess(email), currentGrants(email)]);
  const now = Date.now();
  const features = effectiveFeatures({ plan: access.current.plan, email, config: plans, subscription: access.subscription, grants, now });
  const running = [...runningGrants(grants, now)].filter(([feature]) => features.has(feature)).map(([feature, endsAt]) => ({ feature, endsAt }));
  return { account, current: access.current, features, quotas: access.subscription?.quotas ?? null, grants: running };
}

async function currentAccess(email: string | null): Promise<Access> {
  if (!email) return { current: { plan: "free", endsAt: null }, subscription: null };
  try {
    return await accessForEmail(email);
  } catch (error) {
    // Subscriptions unreadable: fall back to the trial rather than failing the request.
    await reportError(error, { route: "plan", kind: "subscriptions_unreadable" });
    return { current: { plan: "free", endsAt: null }, subscription: null };
  }
}

async function currentGrants(email: string | null): Promise<FeatureGrant[]> {
  if (!email) return [];
  try {
    return await currentGrantsForEmail(email);
  } catch (error) {
    // Unreadable: the plan alone, rather than failing the request.
    await reportError(error, { route: "plan", kind: "grants_unreadable" });
    return [];
  }
}

/**
 * What a plan allows, with a subscription's own limits over it (`quotas` of
 * `resolvePlan`); 0 means no limit. With `features` (those of `resolvePlan`),
 * deep analyses allowed without a monthly count get the emergency cap.
 */
export async function limitsFor(plan: ActivePlan["plan"], config?: PlansConfig, quotas?: QuotaOverrides | null, features?: ReadonlySet<PlanFeature>): Promise<PlanLimits> {
  return (await limitsWithCap(plan, config, quotas, features)).limits;
}

/** `limitsFor`, telling whether the emergency cap applies (the account's card). */
export async function limitsWithCap(plan: ActivePlan["plan"], config?: PlansConfig, quotas?: QuotaOverrides | null, features?: ReadonlySet<PlanFeature>) {
  if (plan === "unlimited") return { limits: { scans: 0, questionsPerDay: 0, parcels: 0, deepPerMonth: 0 }, fallback: false };
  const plans = config ?? (await getPlansConfig());
  let limits: PlanLimits;
  if (plan === "free") {
    const trial = await getTrialConfig();
    // No deep analyses without a plan, but for an offered access (then under the cap).
    limits = { scans: trial.limit, questionsPerDay: trial.askLimit, parcels: plans.freeParcels, deepPerMonth: 0 };
  } else {
    const { scans, questionsPerDay, parcels, deepPerMonth } = plans.offers[plan];
    limits = withQuotas(plan, { scans, questionsPerDay, parcels, deepPerMonth }, quotas);
  }
  return withDeepFallback(plan, limits, features, plans.offers);
}
