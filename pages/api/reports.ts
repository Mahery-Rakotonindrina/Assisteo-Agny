import type { NextApiRequest, NextApiResponse } from "next";
import { applyCors, clientIp, sendError } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";
import { verifyAccount } from "@/lib/server/supabaseAdmin";
import { addUserReport } from "@/lib/server/userReports";
import { UserReportSchema } from "@/lib/userReport";

/** Messages an hour: per account when the e-mail is confirmed, else per address (a mobile network shares one among many people). */
const PER_ACCOUNT = 10;
const PER_ADDRESS = 20;

/** "Give my feedback / Report a problem": text only, a few per hour; read in Admin. */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (applyCors(req, res, ["POST"])) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return sendError(res, 405, "method_not_allowed", "Use POST.");
  }

  // Validated first: a message refused as invalid costs no try.
  const parsed = UserReportSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid message.");
  const { kind, message, contact, screen, appVersion, device } = parsed.data;

  // The e-mail comes from the session, never from the body; a bad token just means "anonymous".
  const account = await verifyAccount(req).catch(() => null);
  const confirmed = account?.email ? account : null;
  const limit = await rateLimit(confirmed ? `report:account:${confirmed.id}` : `report:${clientIp(req)}`, confirmed ? PER_ACCOUNT : PER_ADDRESS, 60 * 60_000);
  if (!limit.ok) return sendError(res, 429, "rate_limited", "Too many messages, try again later.");

  await addUserReport({
    kind,
    message,
    email: confirmed?.email ?? null,
    accountId: account?.id ?? null,
    contact: contact || null,
    screen: screen || null,
    appVersion: appVersion || null,
    device: device || null,
  });
  return res.status(204).end();
}
