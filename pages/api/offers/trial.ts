import type { NextApiRequest, NextApiResponse } from "next";
import { accessPeriod, TRIAL_DAYS, trialEligible } from "@/lib/offers";
import { applyCors, clientIp, sendError } from "@/lib/server/http";
import { claimTrial, releaseTrial, trialClaimed } from "@/lib/server/offerStore";
import { rateLimit } from "@/lib/server/rateLimit";
import { reportError } from "@/lib/server/reportError";
import { addSubscriptions, subscriptionsForEmail } from "@/lib/server/subscriptions";
import { verifyAccount } from "@/lib/server/supabaseAdmin";

export type TrialResponse = { endsAt: string };

/**
 * Starts the 7-day Premium trial, once per account: never for an account
 * that already had a trial, or Premium or above (paid or offered).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse<TrialResponse | unknown>) {
  if (applyCors(req, res, ["POST"])) return;
  if (req.method !== "POST") return sendError(res, 405, "method_not_allowed", "Use POST.");

  const limit = await rateLimit(`offers-trial:${clientIp(req)}`, 10, 60 * 60_000);
  if (!limit.ok) {
    res.setHeader("Retry-After", String(limit.retryAfterS));
    return sendError(res, 429, "rate_limited", "Too many attempts. Try again later.");
  }
  const account = await verifyAccount(req).catch(() => null);
  if (!account?.email) return sendError(res, 401, "invalid_key", "Sign in again.");
  const email = account.email;

  try {
    if (!trialEligible(await subscriptionsForEmail(email)) || (await trialClaimed(email))) return sendError(res, 403, "refused", "The Premium trial was already used.");
    // Against a double tap: only one request goes on.
    if (!(await claimTrial(email))) return sendError(res, 403, "refused", "The Premium trial was already used.");
    const period = accessPeriod(Date.now(), TRIAL_DAYS);
    try {
      await addSubscriptions([{ email, plan: "premium", ...period, amountMga: null, paymentMethod: "trial", paymentRef: null, note: null }]);
    } catch (error) {
      await releaseTrial(email);
      throw error;
    }
    return res.status(201).json({ endsAt: period.endsAt } satisfies TrialResponse);
  } catch (error) {
    await reportError(error, { route: "offers/trial" });
    return sendError(res, 500, "upstream_error", "The trial could not be started.");
  }
}
