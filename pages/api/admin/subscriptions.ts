import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { formatAriary } from "@/lib/format";
import { paidPlans, type Subscription } from "@/lib/plans";
import { guardAdmin } from "@/lib/server/adminAuth";
import { logAdminAction } from "@/lib/server/adminLog";
import { sendError } from "@/lib/server/http";
import { afterPayment } from "@/lib/server/offers";
import { reportError } from "@/lib/server/reportError";
import { accountsEnabled } from "@/lib/server/supabaseAdmin";
import {
  addSubscriptions,
  deleteSubscription,
  getSubscription,
  listSubscriptions,
  planForEmail,
  stopSubscriptions,
  updateSubscription,
} from "@/lib/server/subscriptions";

export type AdminSubscriptionsResponse = { subscriptions: Subscription[] };

const planNames: Record<Subscription["plan"], string> = { lite: "Lite", premium: "Premium", pro: "Pro", unlimited: "Admin" };

/** The log's detail: "rado@example.com · Lite · 5 000 Ar". */
const detail = (emails: string, plan: Subscription["plan"], amountMga: number | null) =>
  [emails, planNames[plan], amountMga ? formatAriary(amountMga, "fr") : null].filter(Boolean).join(" · ");

const Email = z.string().trim().toLowerCase().pipe(z.email());
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => value || null);

const Fields = z.object({
  plan: z.enum(paidPlans),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }).nullable(),
  amountMga: z.number().int().min(0).max(100_000_000).nullable(),
  paymentMethod: optionalText(40),
  paymentRef: optionalText(120),
  note: optionalText(500),
});
const endsAfterStart = (value: { startsAt: string; endsAt: string | null }) => value.endsAt === null || Date.parse(value.endsAt) >= Date.parse(value.startsAt);
const endMessage = { message: "The end must come after the start.", path: ["endsAt"] };

// One payment can cover several people (a family plan).
const AddSchema = Fields.extend({ emails: z.array(Email).min(1).max(20) }).refine(endsAfterStart, endMessage);
const UpdateSchema = Fields.extend({ id: z.uuid(), email: Email }).refine(endsAfterStart, endMessage);
const StopSchema = z.object({ action: z.literal("stop"), email: Email });

/**
 * Admin-only: the subscriptions recorded by the owner. GET lists them, POST
 * adds one per e-mail (a payment then uses up a waiting discount and may
 * reward a referrer, lib/server/offers.ts), PUT edits one, PATCH {action: "stop"} ends an
 * e-mail's access now, DELETE ?id= removes a record. The admin plan
 * ("unlimited") makes its holder an admin: only the owner grants, changes,
 * stops or removes it ("owner_only" for the other admins).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse<AdminSubscriptionsResponse | Subscription | unknown>) {
  const actor = await guardAdmin(req, res);
  if (!actor) return;
  const ownerOnly = () => sendError(res, 403, "owner_only", "Only the owner can grant or take back the admin plan.");
  if (!accountsEnabled) return sendError(res, 503, "unavailable", "Accounts are not configured on the server.");

  try {
    if (req.method === "GET") {
      return res.status(200).json({ subscriptions: await listSubscriptions() } satisfies AdminSubscriptionsResponse);
    }

    if (req.method === "POST") {
      const parsed = AddSchema.safeParse(req.body);
      if (!parsed.success) return sendError(res, 400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid subscription.");
      const { emails, ...fields } = parsed.data;
      if (fields.plan === "unlimited" && !actor.owner) return ownerOnly();
      const created = await addSubscriptions([...new Set(emails)].map((email) => ({ ...fields, email })));
      await logAdminAction(actor.id, "subscription_add", detail(created.map((row) => row.email).join(", "), fields.plan, fields.amountMga));
      // A payment uses up a waiting discount, and may earn a referrer their month.
      await afterPayment(actor.id, created.map((row) => row.email), fields.amountMga);
      return res.status(201).json({ subscriptions: created } satisfies AdminSubscriptionsResponse);
    }

    if (req.method === "PUT") {
      const parsed = UpdateSchema.safeParse(req.body);
      if (!parsed.success) return sendError(res, 400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid subscription.");
      const { id, ...input } = parsed.data;
      if (!actor.owner && (input.plan === "unlimited" || (await getSubscription(id))?.plan === "unlimited")) return ownerOnly();
      const updated = await updateSubscription(id, input);
      await logAdminAction(actor.id, "subscription_edit", detail(updated.email, updated.plan, updated.amountMga));
      return res.status(200).json(updated);
    }

    if (req.method === "PATCH") {
      const parsed = StopSchema.safeParse(req.body);
      if (!parsed.success) return sendError(res, 400, "invalid_request", "Invalid action.");
      if (!actor.owner && (await planForEmail(parsed.data.email)).plan === "unlimited") return ownerOnly();
      await stopSubscriptions(parsed.data.email);
      await logAdminAction(actor.id, "subscription_stop", parsed.data.email);
      return res.status(204).end();
    }

    if (req.method === "DELETE") {
      const id = z.uuid().safeParse(req.query.id);
      if (!id.success) return sendError(res, 400, "invalid_request", "Invalid id.");
      const row = await getSubscription(id.data);
      if (!actor.owner && row?.plan === "unlimited") return ownerOnly();
      await deleteSubscription(id.data);
      if (row) await logAdminAction(actor.id, "subscription_delete", detail(row.email, row.plan, row.amountMga));
      return res.status(204).end();
    }
  } catch (error) {
    await reportError(error, { route: "admin/subscriptions" });
    return sendError(res, 500, "upstream_error", "The subscriptions could not be read or saved.");
  }

  res.setHeader("Allow", "GET, POST, PUT, PATCH, DELETE");
  return sendError(res, 405, "method_not_allowed", "Use GET, POST, PUT, PATCH or DELETE.");
}
