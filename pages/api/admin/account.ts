import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import {
  activePlan,
  activeSubscription,
  createdQuotas,
  customPlanInfo,
  customPlanOf,
  effectiveFeatures,
  featureOrigins,
  normalizeQuotas,
  planFeatures,
  quotaKeys,
  type ActivePlan,
  type CustomPlanInfo,
  type FeatureGrant,
  type FeatureLine,
  type PlanLimits,
} from "@/lib/plans";
import { guardAdmin } from "@/lib/server/adminAuth";
import { logAdminAction } from "@/lib/server/adminLog";
import { addGrant, getGrant, grantsForEmail, grantsReady, stopGrant } from "@/lib/server/featureGrants";
import { sendError } from "@/lib/server/http";
import { limitsFor, limitsWithCap } from "@/lib/server/plan";
import { getPlansConfig } from "@/lib/server/planConfig";
import { reportError } from "@/lib/server/reportError";
import { MigrationNeededError } from "@/lib/server/schemaMissing";
import { ownSettingsReady, subscriptionsForEmail } from "@/lib/server/subscriptions";
import { accountsEnabled } from "@/lib/server/supabaseAdmin";

export type AdminAccountCard = {
  email: string;
  plan: ActivePlan["plan"];
  endsAt: number | null;
  /** A plan created from the Admin (then `plan` is the built-in one just below); missing or null otherwise. */
  customPlan?: CustomPlanInfo | null;
  /** The running subscription whose own settings apply; null on free. */
  subscriptionId: string | null;
  /** Every feature, whether the account has it and why. */
  features: FeatureLine[];
  /** Each limit (0 = no limit), and whether its subscription sets it ("own") or its plan does. */
  quotas: Array<{ key: keyof PlanLimits; value: number; own: boolean; /** Deep analyses allowed with no count: the emergency cap applies. */ fallback?: boolean }>;
  /** Every offer made to it, ended ones included, the latest first. */
  grants: FeatureGrant[];
  /** False before migration 0011: own settings and offers can't be kept yet. */
  ready: { own: boolean; grants: boolean };
};

const Email = z.string().trim().toLowerCase().pipe(z.email());
/** The longest offer: a year and a bit (an offer always ends). */
const MAX_OFFER_MS = 400 * 24 * 3600 * 1000;

const GrantSchema = z.object({
  email: Email,
  feature: z.enum(planFeatures),
  endsAt: z.iso.datetime({ offset: true }),
  note: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .optional()
    .transform((value) => value || null),
});
const StopSchema = z.object({ action: z.literal("stop"), id: z.uuid() });

/**
 * Admin-only: an account's card. GET ?email= gives what it may use and why,
 * its limits and the features offered to it; POST offers a feature for a
 * while (free accounts included); PATCH {action: "stop", id} ends an offer
 * now. Every change goes to the admin log.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse<AdminAccountCard | FeatureGrant | unknown>) {
  const actor = await guardAdmin(req, res);
  if (!actor) return;
  if (!accountsEnabled) return sendError(res, 503, "unavailable", "Accounts are not configured on the server.");

  try {
    if (req.method === "GET") {
      const email = Email.safeParse(req.query.email);
      if (!email.success) return sendError(res, 400, "invalid_request", "Invalid e-mail.");
      return res.status(200).json(await card(email.data));
    }

    if (req.method === "POST") {
      const parsed = GrantSchema.safeParse(req.body);
      if (!parsed.success) return sendError(res, 400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid offer.");
      const { email, feature, endsAt, note } = parsed.data;
      const now = Date.now();
      const end = Date.parse(endsAt);
      if (end <= now + 60_000 || end > now + MAX_OFFER_MS) return sendError(res, 400, "invalid_request", "The end must be in the future, within a year.");
      // Deep analyses without a monthly count would have no limit, on the costliest model: refused, Admin aside.
      if (feature === "deepAnalysis") {
        const { plan, limits } = await planAndLimits(email);
        if (plan !== "unlimited" && limits.deepPerMonth === 0) return sendError(res, 400, "invalid_request", "Deep analyses need a monthly count on this account first.");
      }
      const grant = await addGrant({ email, feature, startsAt: new Date(now).toISOString(), endsAt: new Date(end).toISOString(), note, createdBy: actor.id });
      await logAdminAction(actor.id, "feature_grant", `${email} · ${feature} · ${new Date(end).toISOString().slice(0, 10)}${note ? ` · ${note}` : ""}`);
      return res.status(201).json(grant);
    }

    if (req.method === "PATCH") {
      const parsed = StopSchema.safeParse(req.body);
      if (!parsed.success) return sendError(res, 400, "invalid_request", "Invalid action.");
      const grant = await getGrant(parsed.data.id);
      if (!grant) return sendError(res, 404, "invalid_request", "No such offer.");
      const stopped = await stopGrant(grant);
      await logAdminAction(actor.id, "feature_grant_stop", `${grant.email} · ${grant.feature}`);
      return res.status(200).json(stopped);
    }
  } catch (error) {
    if (error instanceof MigrationNeededError) return sendError(res, 409, "migration_needed", "Apply migration 0011_subscription_features first.");
    await reportError(error, { route: "admin/account" });
    return sendError(res, 500, "upstream_error", "The account could not be read or saved.");
  }

  res.setHeader("Allow", "GET, POST, PATCH");
  return sendError(res, 405, "method_not_allowed", "Use GET, POST or PATCH.");
}

/** The plan an e-mail has now and its limits, its subscription's own included. */
async function planAndLimits(email: string, now = Date.now()) {
  const [rows, config] = await Promise.all([subscriptionsForEmail(email), getPlansConfig()]);
  const current = activePlan(rows, now, config.customPlans);
  const running = activeSubscription(rows, now, config.customPlans);
  // A created plan's limits over the built-in plan below it, its subscription's own over them.
  return { rows, config, current, running, plan: current.plan, limits: await limitsFor(current.plan, config, createdQuotas(config, current.custom, running?.quotas)) };
}

async function card(email: string): Promise<AdminAccountCard> {
  const now = Date.now();
  const [{ config, current, running }, grants, own, offers] = await Promise.all([planAndLimits(email, now), grantsForEmail(email), ownSettingsReady(), grantsReady()]);
  const base = await limitsFor(current.plan, config, createdQuotas(config, current.custom, null));
  const ownQuotas = current.plan === "unlimited" ? null : normalizeQuotas(base, running?.quotas);
  const input = { plan: current.plan, custom: current.custom, email, config, subscription: running, grants, now };
  // The limits as the server applies them, the emergency cap on deep analyses included.
  const capped = await limitsWithCap(current.plan, config, createdQuotas(config, current.custom, running?.quotas), effectiveFeatures(input));
  const created = customPlanOf(config, current.custom);
  return {
    email,
    plan: current.plan,
    endsAt: current.endsAt,
    customPlan: created ? customPlanInfo(created, config.customPlans) : null,
    subscriptionId: running?.id ?? null,
    features: featureOrigins(input),
    quotas: quotaKeys.map((key) =>
      capped.fallback && key === "deepPerMonth"
        ? { key, value: capped.limits.deepPerMonth, own: false, fallback: true }
        : { key, value: ownQuotas?.[key] ?? base[key], own: ownQuotas?.[key] !== undefined },
    ),
    grants,
    ready: { own, grants: offers },
  };
}
