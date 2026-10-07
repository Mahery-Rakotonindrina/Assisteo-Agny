import type { NextApiRequest, NextApiResponse } from "next";
import { isAdmin } from "@/lib/server/adminAuth";
import { AppVersionConfigSchema, getAppVersionConfig, setAppVersionConfig, type AppVersionConfig } from "@/lib/server/appVersionStore";
import { clientIp, sendError } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";

/** Admin-only: read or change the minimum / latest app versions. */
export default async function handler(req: NextApiRequest, res: NextApiResponse<AppVersionConfig | unknown>) {
  if (!process.env.ADMIN_TOKEN) return sendError(res, 503, "unavailable", "Admin is disabled: set ADMIN_TOKEN on the server.");
  const limit = rateLimit(`admin:${clientIp(req)}`, 20, 60_000);
  if (!limit.ok) return sendError(res, 429, "rate_limited", "Too many attempts.");
  if (!isAdmin(req)) return sendError(res, 401, "invalid_key", "Invalid admin token.");
  res.setHeader("Cache-Control", "no-store");

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
