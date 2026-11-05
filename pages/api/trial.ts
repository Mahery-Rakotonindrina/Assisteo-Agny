import type { NextApiRequest, NextApiResponse } from "next";
import { activeProvider } from "@/lib/ai/provider";
import { InstallIdSchema, installIdHeader, type TrialResponse } from "@/lib/ai/schema";
import { applyCors, clientIp, sendError } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";
import { bonusScansLeft } from "@/lib/server/referralBonus";
import { verifyAccount } from "@/lib/server/supabaseAdmin";
import { getTrialUsage } from "@/lib/server/trialStore";

/** How many free trial scans this install (and account, when signed in) has used on the server's AI key. */
export default async function handler(req: NextApiRequest, res: NextApiResponse<TrialResponse | unknown>) {
  if (applyCors(req, res, ["GET"])) return;
  if (req.method !== "GET") return sendError(res, 405, "method_not_allowed", "Use GET.");

  // Generous (a shared connection is common), but a script can't read it in a loop.
  const limit = await rateLimit(`trial-usage:${clientIp(req)}`, 120, 60_000);
  if (!limit.ok) {
    res.setHeader("Retry-After", String(limit.retryAfterS));
    return sendError(res, 429, "rate_limited", "Too many requests.");
  }

  const installId = InstallIdSchema.safeParse(req.headers[installIdHeader]);
  if (!installId.success) return sendError(res, 400, "invalid_request", "Missing install id.");

  res.setHeader("Cache-Control", "no-store");
  const account = await verifyAccount(req).catch(() => null);
  const usage = await getTrialUsage({ installId: installId.data, userId: account?.id ?? null });
  // Scans won through a referral extend the trial.
  const bonus = account?.email && usage.limit > 0 ? await bonusScansLeft(account.email).catch(() => 0) : 0;
  res.status(200).json({ enabled: activeProvider !== "demo", ...usage, limit: usage.limit + bonus } satisfies TrialResponse);
}
