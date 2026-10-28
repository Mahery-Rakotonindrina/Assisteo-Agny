import type { NextApiRequest, NextApiResponse } from "next";
import { deepWithoutLimit, type PlansConfig } from "@/lib/plans";
import { guardAdmin } from "@/lib/server/adminAuth";
import { logAdminAction } from "@/lib/server/adminLog";
import { sendError } from "@/lib/server/http";
import { getPlansConfig, PlansConfigSchema, setPlansConfig } from "@/lib/server/planConfig";

/** Admin-only: read or change the plans' prices, limits and payment instructions. */
export default async function handler(req: NextApiRequest, res: NextApiResponse<PlansConfig | unknown>) {
  const actor = await guardAdmin(req, res);
  if (!actor) return;
  if (req.method === "GET") return res.status(200).json(await getPlansConfig());
  if (req.method === "PUT") {
    const parsed = PlansConfigSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid settings.");
    // The features are saved apart (/api/admin/features): kept as they are.
    const before = await getPlansConfig();
    const config = { ...before, ...parsed.data };
    // A plan with deep analyses can't go back to 0 a month (no limit); one already so doesn't block a save.
    const already = new Set(deepWithoutLimit(before));
    const unlimited = deepWithoutLimit(config).filter((plan) => !already.has(plan));
    if (unlimited.length > 0) return sendError(res, 400, "invalid_request", `Deep analyses need a monthly count: ${unlimited.join(", ")}.`);
    await setPlansConfig(config);
    await logAdminAction(actor.id, "plans_save");
    return res.status(200).json(config);
  }
  res.setHeader("Allow", "GET, PUT");
  return sendError(res, 405, "method_not_allowed", "Use GET or PUT.");
}
