import type { NextApiRequest, NextApiResponse } from "next";
import { activeProvider } from "@/lib/ai/provider";
import { InstallIdSchema, installIdHeader } from "@/lib/ai/schema";
import { soldPlans, type PlanResponse } from "@/lib/plans";
import { applyCors, sendError } from "@/lib/server/http";
import { limitsFor, resolvePlan } from "@/lib/server/plan";
import { getPlansConfig } from "@/lib/server/planConfig";
import { getAskUsage, getPlanUsage, getTrialUsage } from "@/lib/server/trialStore";

/** The user's plan (from their account), its limits and usage, the offers and how to pay. */
export default async function handler(req: NextApiRequest, res: NextApiResponse<PlanResponse | unknown>) {
  if (applyCors(req, res, ["GET"])) return;
  if (req.method !== "GET") return sendError(res, 405, "method_not_allowed", "Use GET.");

  const installId = InstallIdSchema.safeParse(req.headers[installIdHeader]).data ?? null;
  const [{ account, current }, config] = await Promise.all([resolvePlan(req), getPlansConfig()]);
  const limits = await limitsFor(current.plan, config);

  let usage: PlanResponse["usage"];
  if (current.plan !== "free" && account) usage = await getPlanUsage(account.id);
  else if (installId) {
    const [trial, questionsToday] = await Promise.all([getTrialUsage({ installId, userId: account?.id }), getAskUsage(installId)]);
    usage = { scans: trial.used, questionsToday, deep: 0 };
  } else usage = { scans: 0, questionsToday: 0, deep: 0 };

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    enabled: activeProvider !== "demo",
    signedIn: Boolean(account),
    plan: current.plan,
    endsAt: current.endsAt,
    limits,
    usage,
    offers: soldPlans.map((id) => ({ id, ...config.offers[id] })),
    payment: config.payment,
  } satisfies PlanResponse);
}
