import type { NextApiRequest, NextApiResponse } from "next";
import { applyCors, clientIp, sendError } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";
import { verifyAccount } from "@/lib/server/supabaseAdmin";
import { addUserReport } from "@/lib/server/userReports";
import { UserReportSchema } from "@/lib/userReport";

/** "Give my feedback / Report a problem": text only, a few per hour and address; read in Admin. */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (applyCors(req, res, ["POST"])) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return sendError(res, 405, "method_not_allowed", "Use POST.");
  }
  const limit = await rateLimit(`report:${clientIp(req)}`, 5, 60 * 60_000);
  if (!limit.ok) return sendError(res, 429, "rate_limited", "Too many messages, try again later.");

  const parsed = UserReportSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid message.");
  const { kind, message, contact, screen, appVersion, device } = parsed.data;

  // The e-mail comes from the session, never from the body; a bad token just means "anonymous".
  const account = await verifyAccount(req).catch(() => null);
  await addUserReport({
    kind,
    message,
    email: account?.email ?? null,
    contact: contact || null,
    screen: screen || null,
    appVersion: appVersion || null,
    device: device || null,
  });
  return res.status(204).end();
}
