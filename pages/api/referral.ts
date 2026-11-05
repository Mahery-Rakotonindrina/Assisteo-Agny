import type { NextApiRequest, NextApiResponse } from "next";
import type { ReferralSummary } from "@/lib/referralBonus";
import { applyCors, clientIp, sendError } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";
import { referralSummary } from "@/lib/server/referralBonus";
import { verifyAccount } from "@/lib/server/supabaseAdmin";

/** The signed-in account's referral numbers: friends invited and rewarded, scans won and left. */
export default async function handler(req: NextApiRequest, res: NextApiResponse<ReferralSummary | unknown>) {
  if (applyCors(req, res, ["GET"])) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return sendError(res, 405, "method_not_allowed", "Use GET.");
  }
  const limit = await rateLimit(`referral:${clientIp(req)}`, 60, 60_000);
  if (!limit.ok) return sendError(res, 429, "rate_limited", "Too many requests.");
  const account = await verifyAccount(req).catch(() => null);
  if (!account?.email) return sendError(res, 401, "sign_in_required", "Sign in to see your referrals.");
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json(await referralSummary(account.email));
}
