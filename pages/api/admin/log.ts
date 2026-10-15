import type { NextApiRequest, NextApiResponse } from "next";
import { guardAdmin } from "@/lib/server/adminAuth";
import { readAdminLog, type AdminLogEntry } from "@/lib/server/adminLog";
import { sendError } from "@/lib/server/http";

export type AdminLogResponse = { entries: AdminLogEntry[] };

/** Owner-only: what was done in /admin, and by whom, newest first. */
export default async function handler(req: NextApiRequest, res: NextApiResponse<AdminLogResponse | unknown>) {
  if (!(await guardAdmin(req, res, { ownerOnly: true }))) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendError(res, 405, "method_not_allowed", "Use GET.");
  }
  return res.status(200).json({ entries: await readAdminLog() } satisfies AdminLogResponse);
}
