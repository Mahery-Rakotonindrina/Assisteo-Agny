import type { NextApiRequest, NextApiResponse } from "next";
import { ReferralConfigSchema, type ReferralConfig } from "@/lib/referralBonus";
import { guardAdmin } from "@/lib/server/adminAuth";
import { sendError } from "@/lib/server/http";
import { getReferralConfig, referralRewardedTotal, setReferralConfig } from "@/lib/server/referralBonus";

export type AdminReferralResponse = ReferralConfig & { rewarded: number };

/** Admin: what a referral gives (scans for each of the two) and the monthly cap per referrer. */
export default async function handler(req: NextApiRequest, res: NextApiResponse<AdminReferralResponse | unknown>) {
  if (!(await guardAdmin(req, res))) return;
  if (req.method === "GET") return res.status(200).json({ ...(await getReferralConfig()), rewarded: await referralRewardedTotal() } satisfies AdminReferralResponse);
  if (req.method === "PUT") {
    const parsed = ReferralConfigSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid settings.");
    await setReferralConfig(parsed.data);
    return res.status(200).json({ ...parsed.data, rewarded: await referralRewardedTotal() } satisfies AdminReferralResponse);
  }
  res.setHeader("Allow", "GET, PUT");
  return sendError(res, 405, "method_not_allowed", "Use GET or PUT.");
}
