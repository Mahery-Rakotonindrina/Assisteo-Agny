import type { NextApiRequest } from "next";
import { effectiveFeatures, type ActivePlan, type PlanFeature, type PlanLimits, type PlansConfig } from "@/lib/plans";
import { getPlansConfig } from "./planConfig";
import { reportError } from "./reportError";
import { planForEmail } from "./subscriptions";
import { verifyAccount } from "./supabaseAdmin";
import { getTrialConfig } from "./trialStore";

export type ResolvedPlan = {
  account: { id: string; email: string | null } | null;
  current: ActivePlan;
  /** What the account may use (the Admin settings applied): every server check goes by it. */
  features: ReadonlySet<PlanFeature>;
};

/** The signed-in account (if any), its plan right now and what it may use. */
export async function resolvePlan(req: NextApiRequest, config?: PlansConfig): Promise<ResolvedPlan> {
  const [account, plans] = await Promise.all([verifyAccount(req).catch(() => null), config ?? getPlansConfig()]);
  const current = await currentPlan(account?.email ?? null);
  return { account, current, features: effectiveFeatures({ plan: current.plan, email: account?.email ?? null, config: plans }) };
}

async function currentPlan(email: string | null): Promise<ActivePlan> {
  if (!email) return { plan: "free", endsAt: null };
  try {
    return await planForEmail(email);
  } catch (error) {
    // Subscriptions unreadable: fall back to the trial rather than failing the request.
    await reportError(error, { route: "plan", kind: "subscriptions_unreadable" });
    return { plan: "free", endsAt: null };
  }
}

/** What a plan allows; 0 means no limit. */
export async function limitsFor(plan: ActivePlan["plan"], config?: PlansConfig): Promise<PlanLimits> {
  if (plan === "unlimited") return { scans: 0, questionsPerDay: 0, parcels: 0, deepPerMonth: 0 };
  const plans = config ?? (await getPlansConfig());
  if (plan === "free") {
    const trial = await getTrialConfig();
    // No deep analyses without a plan (the feature is refused before any count).
    return { scans: trial.limit, questionsPerDay: trial.askLimit, parcels: plans.freeParcels, deepPerMonth: 0 };
  }
  const { scans, questionsPerDay, parcels, deepPerMonth } = plans.offers[plan];
  return { scans, questionsPerDay, parcels, deepPerMonth };
}
