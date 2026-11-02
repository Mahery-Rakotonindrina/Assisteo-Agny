import type { NextApiRequest, NextApiResponse } from "next";
import { activeProvider } from "@/lib/ai/provider";
import { InstallIdSchema, installIdHeader } from "@/lib/ai/schema";
import { referralCodeFor, trialEligible } from "@/lib/offers";
import { allPlansHeader, customPlanInfo, customPlanOf, featureFromConfig, planFeatureList, planFeatures, soldPlans, subscriptionPayments, type CustomPlan, type PlanResponse, type PlansConfig } from "@/lib/plans";
import { applyCors, sendError } from "@/lib/server/http";
import { limitsFor, resolvePlan } from "@/lib/server/plan";
import { registerReferralCode, trialClaimed } from "@/lib/server/offerStore";
import { pendingDiscount } from "@/lib/server/offers";
import { getPlansConfig } from "@/lib/server/planConfig";
import { reportError } from "@/lib/server/reportError";
import { subscriptionsForEmail } from "@/lib/server/subscriptions";
import { getAskUsage, getPlanUsage, getTrialUsage } from "@/lib/server/trialStore";

/**
 * The user's plan (from their account), its limits and usage, the offers and
 * how to pay. An older app knows only the built-in plans: the created ones
 * reach an app that asks for them (header `x-plans: all`); for the others, `plan`
 * stays the built-in plan just below, and what the account may use comes as
 * always by `features` and `limits`.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse<PlanResponse | unknown>) {
  if (applyCors(req, res, ["GET"])) return;
  if (req.method !== "GET") return sendError(res, 405, "method_not_allowed", "Use GET.");

  const installId = InstallIdSchema.safeParse(req.headers[installIdHeader]).data ?? null;
  const config = await getPlansConfig();
  const { account, current, features, quotas, grants, customPlan } = await resolvePlan(req, config);
  const all = req.headers[allPlansHeader] === "all";
  const limits = await limitsFor(current.plan, config, quotas, features);

  let usage: PlanResponse["usage"];
  if (current.plan !== "free" && account) usage = await getPlanUsage(account.id);
  else if (installId) {
    const [trial, questionsToday] = await Promise.all([getTrialUsage({ installId, userId: account?.id }), getAskUsage(installId)]);
    usage = { scans: trial.used, questionsToday, deep: 0 };
  } else usage = { scans: 0, questionsToday: 0, deep: 0 };

  const offers = account?.email ? await accountOffers(account.id, account.email, config, all) : { trialEligible: false, discount: null, referralCode: null, payments: [] };
  // On sale, and the account's own even once off sale (its card on the offers page).
  const created = all ? config.customPlans.filter((plan) => plan.onSale || plan.id === customPlan?.id) : [];

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    enabled: activeProvider !== "demo",
    signedIn: Boolean(account),
    plan: current.plan,
    endsAt: current.endsAt,
    limits,
    usage,
    offers: [
      ...soldPlans.map((id) => ({ id, ...config.offers[id], features: planFeatureList(id, config) })),
      ...created.map((plan) => ({ ...offerOf(plan), features: planFeatureList(plan.id, config), ...customPlanInfo(plan, config.customPlans) })),
    ],
    customPlan: customPlan ? customPlanInfo(customPlan, config.customPlans) : null,
    payment: config.payment,
    features: planFeatures.filter((feature) => features.has(feature)),
    featureFrom: all ? featureFromConfig(config, true) : featureFromConfig(config),
    grants: grants.map(({ feature, endsAt }) => ({ feature, endsAt: Date.parse(endsAt) })),
    ...offers,
  } satisfies PlanResponse);
}

/** A created plan's price and limits, as an offer. */
const offerOf = ({ id, priceMga, yearPriceMga, scans, questionsPerDay, parcels, deepPerMonth }: CustomPlan) => ({ id, priceMga, yearPriceMga, scans, questionsPerDay, parcels, deepPerMonth });

/**
 * The account's Premium trial, waiting discount, referral code and payments;
 * nothing if unreadable. For an older app (not `all`), a payment for a
 * created plan is shown as the built-in plan just below it.
 */
async function accountOffers(id: string, email: string, config: PlansConfig, all: boolean): Promise<Pick<PlanResponse, "trialEligible" | "discount" | "referralCode" | "payments">> {
  try {
    const referralCode = referralCodeFor(id);
    const [rows, claimed, discount, registered] = await Promise.all([
      subscriptionsForEmail(email),
      trialClaimed(email),
      pendingDiscount(email),
      registerReferralCode(referralCode, email),
    ]);
    // A code already taken by another account (very unlikely) is not shown.
    const payments = subscriptionPayments(rows).map((payment) => (all ? payment : { ...payment, plan: customPlanOf(config, payment.plan)?.after ?? payment.plan }));
    return { trialEligible: !claimed && trialEligible(rows, config.customPlans), discount, referralCode: registered ? referralCode : null, payments };
  } catch (error) {
    await reportError(error, { route: "plan", kind: "offers" });
    return { trialEligible: false, discount: null, referralCode: null, payments: [] };
  }
}
