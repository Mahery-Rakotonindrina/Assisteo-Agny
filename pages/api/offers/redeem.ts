import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { accessPeriod, CODE_PATTERN, hasPaid, normalizeCode, promoProblem, type PromoProblem } from "@/lib/offers";
import { customPlanOf, soldPlans, type PlanName, type SoldPlanId } from "@/lib/plans";
import { getPlansConfig } from "@/lib/server/planConfig";
import { applyCors, clientIp, sendError } from "@/lib/server/http";
import {
  getPromoCode,
  markRedeemed,
  parentOf,
  promoUses,
  referrerOfCode,
  returnPromoUse,
  setParent,
  takePromoUse,
  unmarkRedeemed,
} from "@/lib/server/offerStore";
import { enterDiscountCode } from "@/lib/server/offers";
import { rateLimit } from "@/lib/server/rateLimit";
import { reportError } from "@/lib/server/reportError";
import { addSubscriptions, subscriptionsForEmail } from "@/lib/server/subscriptions";
import { verifyAccount } from "@/lib/server/supabaseAdmin";

export type RedeemRefusal = "unknown" | PromoProblem | "already_used" | "own_code" | "already_referred" | "already_paid";

export type RedeemResponse =
  /** `plan`: always a sold plan (an older app knows no other); for a created plan, the one just below it, with `name` (missing from an older server). */
  | { ok: true; kind: "access"; plan: SoldPlanId; name?: PlanName; endsAt: string }
  | { ok: true; kind: "discount"; code: string; percent: number }
  | { ok: true; kind: "referral" }
  | { ok: false; reason: RedeemRefusal };

const BodySchema = z.object({ code: z.string().max(40) });

/**
 * "I have a code", for a signed-in account: a promo code (an offered
 * access, or a discount kept for the next payment) or someone's referral
 * code. Limited per IP and per account, against guessing.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse<RedeemResponse | unknown>) {
  if (applyCors(req, res, ["POST"])) return;
  if (req.method !== "POST") return sendError(res, 405, "method_not_allowed", "Use POST.");

  const byIp = await rateLimit(`redeem:${clientIp(req)}`, 10, 10 * 60_000);
  if (!byIp.ok) {
    res.setHeader("Retry-After", String(byIp.retryAfterS));
    return sendError(res, 429, "rate_limited", "Too many codes tried. Try again later.");
  }
  const account = await verifyAccount(req).catch(() => null);
  if (!account?.email) return sendError(res, 401, "invalid_key", "Sign in again.");
  const byAccount = await rateLimit(`redeem-account:${account.id}`, 15, 24 * 3600_000);
  if (!byAccount.ok) {
    res.setHeader("Retry-After", String(byAccount.retryAfterS));
    return sendError(res, 429, "rate_limited", "Too many codes tried. Try again tomorrow.");
  }

  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "invalid_request", "Invalid code.");
  const code = normalizeCode(parsed.data.code);
  const email = account.email;
  const refuse = (reason: RedeemRefusal) => res.status(200).json({ ok: false, reason } satisfies RedeemResponse);
  if (!CODE_PATTERN.test(code)) return refuse("unknown");

  try {
    const promo = await getPromoCode(code);
    if (promo) {
      const now = Date.now();
      const problem = promoProblem(promo, await promoUses(code), now);
      if (problem) return refuse(problem);

      if (promo.kind === "discount") {
        // Once per account, its use taken now; used up by the next payment (lib/server/offers.ts).
        const entered = await enterDiscountCode(email, promo);
        if (entered !== "ok") return refuse(entered);
        return res.status(200).json({ ok: true, kind: "discount", code, percent: promo.percent } satisfies RedeemResponse);
      }

      // A created plan deleted or taken off sale since: the code no longer gives it.
      const created = (soldPlans as readonly string[]).includes(promo.plan) ? null : customPlanOf(await getPlansConfig(), promo.plan);
      if (!created && !(soldPlans as readonly string[]).includes(promo.plan)) return refuse("inactive");
      if (created && !created.onSale) return refuse("inactive");

      if (!(await markRedeemed(code, email))) return refuse("already_used");
      if (!(await takePromoUse(code, promo.maxUses))) {
        await unmarkRedeemed(code, email);
        return refuse("used_up");
      }
      const period = accessPeriod(now, promo.days);
      try {
        await addSubscriptions([{ email, plan: promo.plan, ...period, amountMga: null, paymentMethod: "promo", paymentRef: code, note: null }]);
      } catch (error) {
        await unmarkRedeemed(code, email);
        await returnPromoUse(code).catch(() => undefined);
        throw error;
      }
      const shown = created ? { plan: created.after, name: created.name } : { plan: promo.plan as SoldPlanId };
      return res.status(200).json({ ok: true, kind: "access", ...shown, endsAt: period.endsAt } satisfies RedeemResponse);
    }

    const referrer = await referrerOfCode(code);
    if (!referrer) return refuse("unknown");
    if (referrer === email) return refuse("own_code");
    if (await parentOf(email)) return refuse("already_referred");
    if (hasPaid(await subscriptionsForEmail(email))) return refuse("already_paid");
    if (!(await setParent(email, referrer))) return refuse("already_referred");
    return res.status(200).json({ ok: true, kind: "referral" } satisfies RedeemResponse);
  } catch (error) {
    await reportError(error, { route: "offers/redeem" });
    return sendError(res, 500, "upstream_error", "The code could not be checked.");
  }
}
