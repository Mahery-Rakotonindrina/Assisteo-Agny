import type { NextApiRequest, NextApiResponse } from "next";
import { guardAdmin } from "@/lib/server/adminAuth";
import { sendError } from "@/lib/server/http";
import { readUserReports, setUserReportStatus } from "@/lib/server/userReports";
import { ReportStatusSchema, reportsForAdmin, type AdminReportsResponse } from "@/lib/userReport";

/** Admin: the feedback list (GET), and a report marked read or done (PATCH). */
export default async function handler(req: NextApiRequest, res: NextApiResponse<AdminReportsResponse | unknown>) {
  const actor = await guardAdmin(req, res);
  if (!actor) return;
  if (req.method === "GET") {
    // E-mails and contacts are personal data: the owner's alone (stripped here, never sent to the other admins).
    return res.status(200).json(reportsForAdmin(await readUserReports(), actor.owner));
  }
  if (req.method === "PATCH") {
    const parsed = ReportStatusSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "invalid_request", "Invalid report.");
    if (!(await setUserReportStatus(parsed.data.id, parsed.data.status))) return sendError(res, 404, "invalid_request", "Report not found.");
    return res.status(204).end();
  }
  res.setHeader("Allow", "GET, PATCH");
  return sendError(res, 405, "method_not_allowed", "Use GET or PATCH.");
}
