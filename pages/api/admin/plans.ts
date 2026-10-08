import type { NextApiRequest, NextApiResponse } from "next";
import type { PlansConfig } from "@/lib/plans";
import { guardAdmin } from "@/lib/server/adminAuth";
import { sendError } from "@/lib/server/http";
import { getPlansConfig, PlansConfigSchema, setPlansConfig } from "@/lib/server/planConfig";

/** Admin-only: read or change the plans' prices, limits and payment instructions. */
export default async function handler(req: NextApiRequest, res: NextApiResponse<PlansConfig | unknown>) {
  if (!(await guardAdmin(req, res))) return;
  if (req.method === "GET") return res.status(200).json(await getPlansConfig());
  if (req.method === "PUT") {
    const parsed = PlansConfigSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid settings.");
    await setPlansConfig(parsed.data);
    return res.status(200).json(parsed.data);
  }
  res.setHeader("Allow", "GET, PUT");
  return sendError(res, 405, "method_not_allowed", "Use GET or PUT.");
}
