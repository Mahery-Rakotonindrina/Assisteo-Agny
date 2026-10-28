import type { NextApiRequest, NextApiResponse } from "next";
import { activeProvider } from "@/lib/ai/provider";
import { InstallIdSchema, installIdHeader } from "@/lib/ai/schema";
import { referralCodeFor, trialEligible } from "@/lib/offers";
import { featureFromConfig, planFeatureList, planFeatures, soldPlans, type PlanResponse } from "@/lib/plans";
import { applyCors, sendError } from "@/lib/server/http";
import { limitsFor, resolvePlan } from "@/lib/server/plan";
import { registerReferralCode, trialClaimed } from "@/lib/server/offerStore";
import { pendingDiscount } from "@/lib/server/offers";
import { getPlansConfig } from "@/lib/server/planConfig";
import { reportError } from "@/lib/server/reportError";
import { subscriptionsForEmail } from "@/lib/server/subscriptions";
import { getAskUsage, getPlanUsage, getTrialUsage } from "@/lib/server/trialStore";

/** The user's plan (from their account), its limits and usage, the offers and how to pay. */
export default async function handler(req: NextApiRequest, res: NextApiResponse<PlanResponse | unknown>) {
  if (applyCors(req, res, ["GET"])) return;
  if (req.method !== "GET") return sendError(res, 405, "method_not_allowed", "Use GET.");

  const installId = InstallIdSchema.safeParse(req.headers[installIdHeader]).data ?? null;
  const config = await getPlansConfig();
  const { account, current, features } = await resolvePlan(req, config);
  const limits = await limitsFor(current.plan, config);

  let usage: PlanResponse["usage"];
  if (current.plan !== "free" && account) usage = await getPlanUsage(account.id);
  else if (installId) {
    const [trial, questionsToday] = await Promise.all([getTrialUsage({ installId, userId: account?.id }), getAskUsage(installId)]);
    usage = { scans: trial.used, questionsToday, deep: 0 };
  } else usage = { scans: 0, questionsToday: 0, deep: 0 };

  const offers = account?.email ? await accountOffers(account.id, account.email) : { trialEligible: false, discount: null, referralCode: null };

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    enabled: activeProvider !== "demo",
    signedIn: Boolean(account),
    plan: current.plan,
    endsAt: current.endsAt,
    limits,
    usage,
    offers: soldPlans.map((id) => ({ id, ...config.offers[id], features: planFeatureList(id, config) })),
    payment: config.payment,
    features: planFeatures.filter((feature) => features.has(feature)),
    featureFrom: featureFromConfig(config),
    ...offers,
  } satisfies PlanResponse);
}

/** The account's Premium trial, waiting discount and referral code; nothing if unreadable. */
async function accountOffers(id: string, email: string): Promise<Pick<PlanResponse, "trialEligible" | "discount" | "referralCode">> {
  try {
    const referralCode = referralCodeFor(id);
    const [rows, claimed, discount, registered] = await Promise.all([
      subscriptionsForEmail(email),
      trialClaimed(email),
      pendingDiscount(email),
      registerReferralCode(referralCode, email),
    ]);
    // A code already taken by another account (very unlikely) is not shown.
    return { trialEligible: !claimed && trialEligible(rows), discount, referralCode: registered ? referralCode : null };
  } catch (error) {
    await reportError(error, { route: "plan", kind: "offers" });
    return { trialEligible: false, discount: null, referralCode: null };
  }
}
