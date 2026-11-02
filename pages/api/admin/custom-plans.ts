import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { customPlanInUse, customPlanOf, type CustomPlan, type PlansConfig } from "@/lib/plans";
import { guardAdmin } from "@/lib/server/adminAuth";
import { logAdminAction } from "@/lib/server/adminLog";
import { sendError } from "@/lib/server/http";
import { CustomPlanSchema, getPlansConfig, MAX_CUSTOM_PLANS, setCustomPlans } from "@/lib/server/planConfig";
import { reportError } from "@/lib/server/reportError";
import { listSubscriptions } from "@/lib/server/subscriptions";
import { accountsEnabled } from "@/lib/server/supabaseAdmin";

/** POST: a new plan (on sale from now). PUT: changes one; its id stays as it was created. */
const CreateSchema = CustomPlanSchema.omit({ onSale: true, createdAt: true });
const UpdateSchema = CustomPlanSchema.omit({ createdAt: true });

/** The log's detail: "famille · Famille · après lite · 8 000 Ar". */
const detail = (plan: CustomPlan) => `${plan.id} · ${plan.name.fr} · après ${plan.after} · ${plan.priceMga} Ar${plan.onSale ? "" : " · hors vente"}`;

/**
 * Admin-only: the plans created from the Admin (Admin → Offers). POST
 * creates one, PUT changes one (name, colour, rank, price, limits, features,
 * on sale or not), DELETE ?id= removes one nobody has running or starting
 * later ("refused" otherwise: it can then only go off sale, its subscribers
 * keeping it until their end). Each answer is the whole settings.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse<PlansConfig | unknown>) {
  const actor = await guardAdmin(req, res);
  if (!actor) return;

  // Deep analyses need a monthly count, as on the sold plans (0 = no limit on the costliest model).
  const deepRefused = (plan: CustomPlan) => plan.features.includes("deepAnalysis") && plan.deepPerMonth === 0;

  if (req.method === "POST") {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid plan.");
    const config = await getPlansConfig();
    if (customPlanOf(config, parsed.data.id)) return sendError(res, 400, "invalid_request", "This id is already taken.");
    if (config.customPlans.length >= MAX_CUSTOM_PLANS) return sendError(res, 400, "invalid_request", `At most ${MAX_CUSTOM_PLANS} created plans.`);
    const plan: CustomPlan = { ...parsed.data, onSale: true, createdAt: Date.now() };
    if (deepRefused(plan)) return sendError(res, 400, "invalid_request", "Deep analyses need a monthly count.");
    const saved = await setCustomPlans([...config.customPlans, plan]);
    await logAdminAction(actor.id, "plan_create", detail(plan));
    return res.status(201).json(saved);
  }

  if (req.method === "PUT") {
    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid plan.");
    const config = await getPlansConfig();
    const before = customPlanOf(config, parsed.data.id);
    if (!before) return sendError(res, 404, "invalid_request", "No such plan.");
    const plan: CustomPlan = { ...parsed.data, createdAt: before.createdAt };
    // One already without a count doesn't block a save (an emergency change still goes through).
    if (deepRefused(plan) && !deepRefused(before)) return sendError(res, 400, "invalid_request", "Deep analyses need a monthly count.");
    // A plan moved to another slot goes to the end of it.
    const others = config.customPlans.filter((entry) => entry.id !== plan.id);
    const list = before.after === plan.after ? config.customPlans.map((entry) => (entry.id === plan.id ? plan : entry)) : [...others, plan];
    const saved = await setCustomPlans(list);
    await logAdminAction(actor.id, "plan_edit", detail(plan));
    return res.status(200).json(saved);
  }

  if (req.method === "DELETE") {
    const id = z.string().max(24).safeParse(req.query.id);
    const config = await getPlansConfig();
    const plan = id.success ? customPlanOf(config, id.data) : null;
    if (!plan) return sendError(res, 404, "invalid_request", "No such plan.");
    if (accountsEnabled) {
      try {
        if (customPlanInUse(plan.id, await listSubscriptions(), Date.now())) return sendError(res, 409, "refused", "Someone has this plan: take it off sale instead.");
      } catch (error) {
        // Unknown whether someone has it: not deleted.
        await reportError(error, { route: "admin/custom-plans", kind: "subscriptions_unreadable" });
        return sendError(res, 500, "upstream_error", "The subscriptions could not be read.");
      }
    }
    const saved = await setCustomPlans(config.customPlans.filter((entry) => entry.id !== plan.id));
    await logAdminAction(actor.id, "plan_delete", detail(plan));
    return res.status(200).json(saved);
  }

  res.setHeader("Allow", "POST, PUT, DELETE");
  return sendError(res, 405, "method_not_allowed", "Use POST, PUT or DELETE.");
}
