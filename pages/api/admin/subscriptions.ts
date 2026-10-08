import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { paidPlans, type Subscription } from "@/lib/plans";
import { guardAdmin } from "@/lib/server/adminAuth";
import { sendError } from "@/lib/server/http";
import { reportError } from "@/lib/server/reportError";
import { accountsEnabled } from "@/lib/server/supabaseAdmin";
import {
  addSubscriptions,
  deleteSubscription,
  listSubscriptions,
  stopSubscriptions,
  updateSubscription,
} from "@/lib/server/subscriptions";

export type AdminSubscriptionsResponse = { subscriptions: Subscription[] };

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
 * adds one per e-mail, PUT edits one, PATCH {action: "stop"} ends an
 * e-mail's access now, DELETE ?id= removes a record.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse<AdminSubscriptionsResponse | Subscription | unknown>) {
  if (!(await guardAdmin(req, res))) return;
  if (!accountsEnabled) return sendError(res, 503, "unavailable", "Accounts are not configured on the server.");

  try {
    if (req.method === "GET") {
      return res.status(200).json({ subscriptions: await listSubscriptions() } satisfies AdminSubscriptionsResponse);
    }

    if (req.method === "POST") {
      const parsed = AddSchema.safeParse(req.body);
      if (!parsed.success) return sendError(res, 400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid subscription.");
      const { emails, ...fields } = parsed.data;
      const created = await addSubscriptions([...new Set(emails)].map((email) => ({ ...fields, email })));
      return res.status(201).json({ subscriptions: created } satisfies AdminSubscriptionsResponse);
    }

    if (req.method === "PUT") {
      const parsed = UpdateSchema.safeParse(req.body);
      if (!parsed.success) return sendError(res, 400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid subscription.");
      const { id, ...input } = parsed.data;
      return res.status(200).json(await updateSubscription(id, input));
    }

    if (req.method === "PATCH") {
      const parsed = StopSchema.safeParse(req.body);
      if (!parsed.success) return sendError(res, 400, "invalid_request", "Invalid action.");
      await stopSubscriptions(parsed.data.email);
      return res.status(204).end();
    }

    if (req.method === "DELETE") {
      const id = z.uuid().safeParse(req.query.id);
      if (!id.success) return sendError(res, 400, "invalid_request", "Invalid id.");
      await deleteSubscription(id.data);
      return res.status(204).end();
    }
  } catch (error) {
    await reportError(error, { route: "admin/subscriptions" });
    return sendError(res, 500, "upstream_error", "The subscriptions could not be read or saved.");
  }

  res.setHeader("Allow", "GET, POST, PUT, PATCH, DELETE");
  return sendError(res, 405, "method_not_allowed", "Use GET, POST, PUT, PATCH or DELETE.");
}
