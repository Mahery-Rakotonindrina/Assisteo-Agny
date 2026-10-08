import type { NextApiRequest } from "next";
import type { ActivePlan, PlanLimits, PlansConfig } from "@/lib/plans";
import { getPlansConfig } from "./planConfig";
import { reportError } from "./reportError";
import { planForEmail } from "./subscriptions";
import { verifyAccount } from "./supabaseAdmin";
import { getTrialConfig } from "./trialStore";

/** The signed-in account (if any) and its plan right now. */
export async function resolvePlan(req: NextApiRequest): Promise<{ account: { id: string; email: string | null } | null; current: ActivePlan }> {
  const account = await verifyAccount(req).catch(() => null);
  if (!account?.email) return { account, current: { plan: "free", endsAt: null } };
  try {
    return { account, current: await planForEmail(account.email) };
  } catch (error) {
    // Subscriptions unreadable: fall back to the trial rather than failing the request.
    await reportError(error, { route: "plan", kind: "subscriptions_unreadable" });
    return { account, current: { plan: "free", endsAt: null } };
  }
}

/** What a plan allows; 0 means no limit. */
export async function limitsFor(plan: ActivePlan["plan"], config?: PlansConfig): Promise<PlanLimits> {
  if (plan === "unlimited") return { scans: 0, questionsPerDay: 0, parcels: 0 };
  const plans = config ?? (await getPlansConfig());
  if (plan === "free") {
    const trial = await getTrialConfig();
    return { scans: trial.limit, questionsPerDay: trial.askLimit, parcels: plans.freeParcels };
  }
  const { scans, questionsPerDay, parcels } = plans.offers[plan];
  return { scans, questionsPerDay, parcels };
}
