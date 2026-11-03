import type { NextApiRequest, NextApiResponse } from "next";
import { InstallIdSchema, installIdHeader } from "@/lib/ai/schema";
import { accessPeriod, TRIAL_DAYS, trialEligible } from "@/lib/offers";
import { applyCors, clientIp, sendError } from "@/lib/server/http";
import { claimTrial, releaseTrial, trialClaimed } from "@/lib/server/offerStore";
import { getPlansConfig } from "@/lib/server/planConfig";
import { rateLimit } from "@/lib/server/rateLimit";
import { reportError } from "@/lib/server/reportError";
import { addSubscriptions, subscriptionsForEmail } from "@/lib/server/subscriptions";
import { verifyAccount } from "@/lib/server/supabaseAdmin";
import { releaseTrialStart, reserveTrialStart } from "@/lib/server/trialStore";

export type TrialResponse = { endsAt: string };

/**
 * Starts the 7-day Premium trial, once per person: never for an account that
 * already had a trial, or Premium or above (paid or offered). A person is the
 * e-mail without its "+tag" (and Gmail dots), the install and the IP, and the
 * trials started per day are capped for everyone together.
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
  // An older app sends no install id: then the IP and the day's cap still apply.
  const subject = { installId: InstallIdSchema.safeParse(req.headers[installIdHeader]).data ?? null, ip: clientIp(req) };

  try {
    if (!trialEligible(await subscriptionsForEmail(email), (await getPlansConfig()).customPlans) || (await trialClaimed(email))) return sendError(res, 403, "refused", "The Premium trial was already used.");
    // Against a double tap: only one request goes on.
    if (!(await claimTrial(email))) return sendError(res, 403, "refused", "The Premium trial was already used.");
    const refused = await reserveTrialStart(subject);
    if (refused) {
      await releaseTrial(email);
      if (refused === "day") return sendError(res, 503, "server_busy", "Too many trials started today: come back tomorrow.");
      return sendError(res, 403, "refused", "The Premium trial was already used.");
    }
    const period = accessPeriod(Date.now(), TRIAL_DAYS);
    try {
      await addSubscriptions([{ email, plan: "premium", ...period, amountMga: null, paymentMethod: "trial", paymentRef: null, note: null }]);
    } catch (error) {
      await Promise.all([releaseTrial(email), releaseTrialStart(subject)]);
      throw error;
    }
    return res.status(201).json({ endsAt: period.endsAt } satisfies TrialResponse);
  } catch (error) {
    await reportError(error, { route: "offers/trial" });
    return sendError(res, 500, "upstream_error", "The trial could not be started.");
  }
}
