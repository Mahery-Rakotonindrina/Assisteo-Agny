import type { NextApiRequest, NextApiResponse } from "next";
import { guardAdmin } from "@/lib/server/adminAuth";
import { logAdminAction } from "@/lib/server/adminLog";
import { AppVersionConfigSchema, getAppVersionConfig, setAppVersionConfig, type AppVersionConfig } from "@/lib/server/appVersionStore";
import { sendError } from "@/lib/server/http";

/** Admin-only: read or change the minimum / latest app versions. */
export default async function handler(req: NextApiRequest, res: NextApiResponse<AppVersionConfig | unknown>) {
  // Also reached by the APK workflow (ADMIN_TOKEN + CRON_SECRET) to announce a new version.
  const actor = await guardAdmin(req, res, { machine: true });
  if (!actor) return;

  if (req.method === "GET") return res.status(200).json(await getAppVersionConfig());
  if (req.method === "PUT") {
    const parsed = AppVersionConfigSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid settings.");
    await setAppVersionConfig(parsed.data);
    await logAdminAction(actor.id, "app_save", [parsed.data.minimum, parsed.data.latest].join(" · "));
    return res.status(200).json(parsed.data);
  }
  res.setHeader("Allow", "GET, PUT");
  return sendError(res, 405, "method_not_allowed", "Use GET or PUT.");
}
