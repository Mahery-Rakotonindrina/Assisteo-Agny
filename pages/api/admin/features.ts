import type { NextApiRequest, NextApiResponse } from "next";
import { activeSubscriberCounts, describeChange, featureChanges } from "@/lib/featureChanges";
import { deepWithoutLimit, type FeatureSettings, type PaidPlanId, type PlansConfig, type SoldPlanId } from "@/lib/plans";
import { guardAdmin } from "@/lib/server/adminAuth";
import { logAdminAction } from "@/lib/server/adminLog";
import { sendError } from "@/lib/server/http";
import { FeatureSettingsSchema, getPlansConfig, setFeatureSettings } from "@/lib/server/planConfig";
import { reportError } from "@/lib/server/reportError";
import { listSubscriptions } from "@/lib/server/subscriptions";
import { accountsEnabled } from "@/lib/server/supabaseAdmin";

export type AdminFeaturesResponse = FeatureSettings & {
  /** The accounts on each paid plan right now; null when the subscriptions can't be read. */
  subscribers: Record<PaidPlanId, number> | null;
  /** Each offer's deep analyses per month (0 = no limit): deep analyses can't be ticked on 0. */
  deepPerMonth: Record<SoldPlanId, number>;
};

/** Admin-only: the features of each plan and the state of each feature (on, in test, switched off). */
export default async function handler(req: NextApiRequest, res: NextApiResponse<AdminFeaturesResponse | unknown>) {
  const actor = await guardAdmin(req, res);
  if (!actor) return;
  if (req.method === "GET") return res.status(200).json(await withSubscribers(await getPlansConfig()));
  if (req.method === "PUT") {
    const parsed = FeatureSettingsSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid settings.");
    const before = await getPlansConfig();
    // Only a newly ticked deep analysis is refused: an emergency cut still goes through.
    const already = new Set(deepWithoutLimit(before));
    const unlimited = deepWithoutLimit({ ...before, ...parsed.data }).filter((plan) => !already.has(plan));
    if (unlimited.length > 0) return sendError(res, 400, "invalid_request", `Deep analyses need a monthly count first: ${unlimited.join(", ")}.`);
    const saved = await setFeatureSettings(parsed.data);
    // One line per change: who changed what, for the log.
    for (const change of featureChanges(before, saved)) await logAdminAction(actor.id, change.kind === "plan" ? "feature_plans" : "feature_status", describeChange(change));
    return res.status(200).json(await withSubscribers(saved));
  }
  res.setHeader("Allow", "GET, PUT");
  return sendError(res, 405, "method_not_allowed", "Use GET or PUT.");
}

async function withSubscribers({ features, featureStatus, offers }: PlansConfig): Promise<AdminFeaturesResponse> {
  const deepPerMonth = { lite: offers.lite.deepPerMonth, premium: offers.premium.deepPerMonth, pro: offers.pro.deepPerMonth };
  let subscribers: AdminFeaturesResponse["subscribers"] = null;
  if (!accountsEnabled) return { features, featureStatus, subscribers, deepPerMonth };
  try {
    subscribers = activeSubscriberCounts(await listSubscriptions(), Date.now());
  } catch (error) {
    await reportError(error, { route: "admin/features", kind: "subscriptions_unreadable" });
  }
  return { features, featureStatus, subscribers, deepPerMonth };
}
