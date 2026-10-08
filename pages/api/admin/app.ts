import type { NextApiRequest, NextApiResponse } from "next";
import { guardAdmin } from "@/lib/server/adminAuth";
import { AppVersionConfigSchema, getAppVersionConfig, setAppVersionConfig, type AppVersionConfig } from "@/lib/server/appVersionStore";
import { sendError } from "@/lib/server/http";

/** Admin-only: read or change the minimum / latest app versions. */
export default async function handler(req: NextApiRequest, res: NextApiResponse<AppVersionConfig | unknown>) {
  if (!(await guardAdmin(req, res))) return;

  if (req.method === "GET") return res.status(200).json(await getAppVersionConfig());
  if (req.method === "PUT") {
    const parsed = AppVersionConfigSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid settings.");
    await setAppVersionConfig(parsed.data);
    return res.status(200).json(parsed.data);
  }
  res.setHeader("Allow", "GET, PUT");
  return sendError(res, 405, "method_not_allowed", "Use GET or PUT.");
}
