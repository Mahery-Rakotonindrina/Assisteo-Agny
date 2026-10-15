import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { CODE_PATTERN, normalizeCode, type PromoCode, type PromoWithUses } from "@/lib/offers";
import { soldPlans } from "@/lib/plans";
import { guardAdmin } from "@/lib/server/adminAuth";
import { logAdminAction } from "@/lib/server/adminLog";
import { sendError } from "@/lib/server/http";
import {
  deletePromoCode,
  getPromoCode,
  listPromoCodes,
  offersAreDurable,
  referrerOfCode,
  savePromoCode,
  type PendingDiscount,
} from "@/lib/server/offerStore";
import { pendingDiscount } from "@/lib/server/offers";
import { reportError } from "@/lib/server/reportError";

export type AdminPromoCodesResponse = { codes: PromoWithUses[]; durable: boolean };
/** GET ?email=: the discount waiting for that e-mail's next payment. */
export type AdminDiscountResponse = { discount: PendingDiscount | null };

const Code = z.string().transform(normalizeCode).pipe(z.string().regex(CODE_PATTERN, "3 to 24 letters, digits or dashes."));

const CreateSchema = z
  .object({
    code: Code,
    kind: z.enum(["access", "discount"]),
    plan: z.enum(soldPlans),
    days: z.number().int().min(1).max(366),
    percent: z.number().int().min(1).max(100),
    maxUses: z.number().int().min(0).max(100_000),
    expiresAt: z.number().int().positive().nullable(),
  })
  .partial({ plan: true, days: true, percent: true });
const ToggleSchema = z.object({ code: Code, active: z.boolean() });

/** The log's detail: "NOEL · Premium 30 j" or "BIENVENUE · -20 %". */
const detail = (promo: PromoCode) => (promo.kind === "access" ? `${promo.code} · ${promo.plan} ${promo.days} j` : `${promo.code} · -${promo.percent} %`);

/**
 * Admin-only: the promo codes. GET lists them (or, with ?email=, the
 * discount waiting for that e-mail), POST creates one, PATCH turns one on
 * or off, DELETE ?code= removes it.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse<AdminPromoCodesResponse | AdminDiscountResponse | unknown>) {
  const actor = await guardAdmin(req, res);
  if (!actor) return;

  try {
    if (req.method === "GET") {
      const email = z.string().trim().toLowerCase().pipe(z.email()).safeParse(req.query.email);
      if (email.success) return res.status(200).json({ discount: await pendingDiscount(email.data) } satisfies AdminDiscountResponse);
      return res.status(200).json({ codes: await listPromoCodes(), durable: offersAreDurable } satisfies AdminPromoCodesResponse);
    }

    if (req.method === "POST") {
      const parsed = CreateSchema.safeParse(req.body);
      if (!parsed.success) return sendError(res, 400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid code.");
      const input = parsed.data;
      if (input.kind === "access" && (!input.plan || !input.days)) return sendError(res, 400, "invalid_request", "An access code needs a plan and days.");
      if (input.kind === "discount" && !input.percent) return sendError(res, 400, "invalid_request", "A discount code needs a percentage.");
      // A promo code must not hide a referral code (or another promo code).
      if ((await getPromoCode(input.code)) || (await referrerOfCode(input.code))) return sendError(res, 409, "invalid_request", "This code already exists.");
      const promo: PromoCode = {
        code: input.code,
        kind: input.kind,
        plan: input.plan ?? "lite",
        days: input.kind === "access" ? input.days! : 0,
        percent: input.kind === "discount" ? input.percent! : 0,
        maxUses: input.maxUses,
        expiresAt: input.expiresAt,
        active: true,
        createdAt: Date.now(),
      };
      await savePromoCode(promo);
      await logAdminAction(actor.id, "promo_create", detail(promo));
      return res.status(201).json({ ...promo, uses: 0 } satisfies PromoWithUses);
    }

    if (req.method === "PATCH") {
      const parsed = ToggleSchema.safeParse(req.body);
      if (!parsed.success) return sendError(res, 400, "invalid_request", "Invalid code.");
      const promo = await getPromoCode(parsed.data.code);
      if (!promo) return sendError(res, 404, "invalid_request", "Unknown code.");
      await savePromoCode({ ...promo, active: parsed.data.active });
      await logAdminAction(actor.id, parsed.data.active ? "promo_enable" : "promo_disable", promo.code);
      return res.status(204).end();
    }

    if (req.method === "DELETE") {
      const code = Code.safeParse(req.query.code);
      if (!code.success) return sendError(res, 400, "invalid_request", "Invalid code.");
      const promo = await getPromoCode(code.data);
      await deletePromoCode(code.data);
      if (promo) await logAdminAction(actor.id, "promo_delete", detail(promo));
      return res.status(204).end();
    }
  } catch (error) {
    await reportError(error, { route: "admin/promo-codes" });
    return sendError(res, 500, "upstream_error", "The promo codes could not be read or saved.");
  }

  res.setHeader("Allow", "GET, POST, PATCH, DELETE");
  return sendError(res, 405, "method_not_allowed", "Use GET, POST, PATCH or DELETE.");
}
