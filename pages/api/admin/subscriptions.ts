import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { describeOwn } from "@/lib/featureChanges";
import { formatAriary } from "@/lib/format";
import { customPlanIdPattern, customPlanOf, normalizeDiff, normalizeQuotas, paidPlans, planListOf, planOfferOf, subscriptionDeepWithoutLimit, type CustomPlan, type PlansConfig, type Subscription } from "@/lib/plans";
import { guardAdmin } from "@/lib/server/adminAuth";
import { logAdminAction } from "@/lib/server/adminLog";
import { sendError } from "@/lib/server/http";
import { afterPayment } from "@/lib/server/offers";
import { FeatureDiffSchema, getPlansConfig, QuotasSchema } from "@/lib/server/planConfig";
import { MigrationNeededError } from "@/lib/server/schemaMissing";
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

/** `customPlans`: the plans created from the Admin, to name and rank their subscriptions (missing from an older server). */
export type AdminSubscriptionsResponse = { subscriptions: Subscription[]; customPlans?: CustomPlan[] };

const planNames: Record<string, string> = { lite: "Lite", premium: "Premium", pro: "Pro", unlimited: "Admin" };

/** The log's detail: "rado@example.com · Lite · 5 000 Ar" (a created plan by its French name). */
const detail = (emails: string, plan: Subscription["plan"], amountMga: number | null, config?: PlansConfig) =>
  [emails, planNames[plan] ?? (config && customPlanOf(config, plan)?.name.fr) ?? plan, amountMga ? formatAriary(amountMga, "fr") : null].filter(Boolean).join(" · ");

const Email = z.string().trim().toLowerCase().pipe(z.email());
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => value || null);

const Fields = z.object({
  // A built-in plan, or one created from the Admin (checked against the settings below).
  plan: z.union([z.enum(paidPlans), z.string().regex(customPlanIdPattern)]),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }).nullable(),
  amountMga: z.number().int().min(0).max(100_000_000).nullable(),
  paymentMethod: optionalText(40),
  paymentRef: optionalText(120),
  note: optionalText(500),
  // Its own features and limits (migration 0011); missing or null: the plan's.
  features: FeatureDiffSchema.nullable().optional(),
  quotas: QuotasSchema.nullable().optional(),
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
      const [subscriptions, config] = await Promise.all([listSubscriptions(), getPlansConfig()]);
      return res.status(200).json({ subscriptions, customPlans: config.customPlans } satisfies AdminSubscriptionsResponse);
    }

    // Its own settings, kept only where they differ from the plan; deep analyses without a count refused.
    const own = <T extends { plan: Subscription["plan"]; features?: Subscription["features"]; quotas?: Subscription["quotas"] }>(fields: T, config: PlansConfig): T | null => {
      const offer = planOfferOf(config, fields.plan);
      if (fields.plan === "unlimited" || !offer) return { ...fields, features: fields.features === undefined ? undefined : null, quotas: fields.quotas === undefined ? undefined : null };
      const features = fields.features === undefined ? undefined : normalizeDiff(planListOf(config, fields.plan), fields.features);
      const quotas = fields.quotas === undefined ? undefined : normalizeQuotas(offer, fields.quotas);
      return subscriptionDeepWithoutLimit(fields.plan, config, features, quotas) ? null : { ...fields, features, quotas };
    };
    const deepRefused = () => sendError(res, 400, "invalid_request", "Deep analyses need a monthly count on this subscription.");
    // A created plan must exist; a new subscription to one needs it on sale (a record already made stays editable).
    const unknownPlan = (plan: string, config: PlansConfig, adding: boolean) => {
      if ((paidPlans as readonly string[]).includes(plan)) return false;
      const created = customPlanOf(config, plan);
      return !created || (adding && !created.onSale);
    };
    const planRefused = () => sendError(res, 400, "invalid_request", "This plan doesn't exist or is off sale.");
    const ownDetail = (row: Subscription) => describeOwn(row.features, row.quotas);

    if (req.method === "POST") {
      const parsed = AddSchema.safeParse(req.body);
      if (!parsed.success) return sendError(res, 400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid subscription.");
      const { emails, ...given } = parsed.data;
      if (given.plan === "unlimited" && !actor.owner) return ownerOnly();
      const config = await getPlansConfig();
      if (unknownPlan(given.plan, config, true)) return planRefused();
      const fields = own(given, config);
      if (!fields) return deepRefused();
      const created = await addSubscriptions([...new Set(emails)].map((email) => ({ ...fields, email })));
      await logAdminAction(actor.id, "subscription_add", [detail(created.map((row) => row.email).join(", "), fields.plan, fields.amountMga, config), created[0] && ownDetail(created[0])].filter(Boolean).join(" · "));
      // A payment uses up a waiting discount, and may earn a referrer their month.
      await afterPayment(actor.id, created.map((row) => row.email), fields.amountMga);
      return res.status(201).json({ subscriptions: created } satisfies AdminSubscriptionsResponse);
    }

    if (req.method === "PUT") {
      const parsed = UpdateSchema.safeParse(req.body);
      if (!parsed.success) return sendError(res, 400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid subscription.");
      const { id, ...given } = parsed.data;
      if (!actor.owner && (given.plan === "unlimited" || (await getSubscription(id))?.plan === "unlimited")) return ownerOnly();
      const config = await getPlansConfig();
      const before = await getSubscription(id);
      if (unknownPlan(given.plan, config, before?.plan !== given.plan)) return planRefused();
      const input = own(given, config);
      if (!input) return deepRefused();
      const updated = await updateSubscription(id, input);
      await logAdminAction(actor.id, "subscription_edit", [detail(updated.email, updated.plan, updated.amountMga, config), ownDetail(updated) || (input.features === null && input.quotas === null ? "plan" : "")].filter(Boolean).join(" · "));
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
      if (row) await logAdminAction(actor.id, "subscription_delete", detail(row.email, row.plan, row.amountMga, await getPlansConfig()));
      return res.status(204).end();
    }
  } catch (error) {
    // Its own features or limits, before migration 0011: refused rather than saved without them.
    if (error instanceof MigrationNeededError) return sendError(res, 409, "migration_needed", `Apply migration ${error.migration} first.`);
    await reportError(error, { route: "admin/subscriptions" });
    return sendError(res, 500, "upstream_error", "The subscriptions could not be read or saved.");
  }

  res.setHeader("Allow", "GET, POST, PUT, PATCH, DELETE");
  return sendError(res, 405, "method_not_allowed", "Use GET, POST, PUT, PATCH or DELETE.");
}
