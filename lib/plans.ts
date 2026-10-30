// Plans: free (the trial), the three sold ones, and full access for the
// administrators. They form a ladder: each plan includes everything below it.
// Payment happens outside the app; the owner records it in /admin as a
// subscription (an email, a plan, a period).

export const soldPlans = ["lite", "premium", "pro"] as const;
export const paidPlans = [...soldPlans, "unlimited"] as const;
export const planIds = ["free", ...paidPlans] as const;

export type PlanId = (typeof planIds)[number];
export type PaidPlanId = (typeof paidPlans)[number];

export const planRank: Record<PlanId, number> = { free: 0, lite: 1, premium: 2, pro: 3, unlimited: 4 };

export type PlanFeature =
  /** Scanning with one's own AI key. */
  | "ownKey"
  /** Prices and fees in ariary on parcels. */
  | "parcelCosts"
  /** Reseller tools: a client per parcel, totals per client. */
  | "reseller"
  /** Analysing a scan again with a more capable (and costlier) model. */
  | "deepAnalysis"
  /** Scanning a document in several pages, analysed as one. */
  | "multiPage"
  /** Clean PDFs of a document, or of several scans from the history. */
  | "pdfExport"
  /** "Mon garage": vehicles, service log, reminders, fuel and expenses. */
  | "garage"
  /** Reminders: on a scan (with repetition, snooze, calendar), insurance notices, parcel arrivals, the garage. */
  | "reminders"
  /** "Mes dépenses": the monthly budget. Admin only while tested; opening it is a change of featureFrom alone. */
  | "expenses"
  /** "Prêts": who owes me, whom I owe. Admin only while tested, like "expenses". */
  | "loans"
  /** "Mes plantes": the plants, their watering and morning reminder, the diagnosis of a problem. */
  | "plants";

/** Every feature, in the order of the Admin table and of the offers page. */
export const planFeatures = ["reminders", "parcelCosts", "pdfExport", "ownKey", "deepAnalysis", "multiPage", "garage", "plants", "reseller", "expenses", "loans"] as const satisfies readonly PlanFeature[];
// Fails to compile when a feature is missing from the list.
const everyFeatureListed: Exclude<PlanFeature, (typeof planFeatures)[number]> extends never ? true : never = true;
void everyFeatureListed;

/**
 * The built-in ladder: the lowest plan that includes each feature. It is the
 * default of the Admin settings (`PlansConfig.features`), and what an app
 * goes by until the server sent its settings (an older APK keeps it).
 */
const featureFrom: Record<PlanFeature, PlanId> = { ownKey: "lite", parcelCosts: "lite", reseller: "pro", deepAnalysis: "premium", multiPage: "premium", pdfExport: "lite", garage: "premium", reminders: "lite", expenses: "unlimited", loans: "unlimited", plants: "lite" };

/**
 * What a feature needs to work: it is dropped when one of them is missing.
 * The reseller tools (a client per parcel, what each client owes, totals per
 * client, statements) are built on the parcels' costs. The garage's and the
 * budget's own reminders are not features of their own: they already ask for
 * both ("garage" and "reminders", "expenses" and "reminders").
 */
export const featureNeeds: Partial<Record<PlanFeature, readonly PlanFeature[]>> = { reseller: ["parcelCosts"] };

/** The features that need `feature`, directly or not (to untick with it). */
export function featureDependents(feature: PlanFeature): PlanFeature[] {
  const found = new Set<PlanFeature>();
  const visit = (needed: PlanFeature) => {
    for (const other of planFeatures) {
      if (!found.has(other) && featureNeeds[other]?.includes(needed)) {
        found.add(other);
        visit(other);
      }
    }
  };
  visit(feature);
  return planFeatures.filter((other) => found.has(other));
}

/**
 * Full access is the administrators' plan: it shows the Admin menu. The admin
 * page and its API still ask for the admin token.
 */
export function isAdminPlan(plan: PlanId) {
  return plan === "unlimited";
}

/** The built-in ladder only; the settings go through `effectiveFeatures` (server) or `usePlan` (app). */
export function hasFeature(plan: PlanId, feature: PlanFeature) {
  return planRank[plan] >= planRank[featureFrom[feature]];
}

/** The plan to suggest for a feature, by the built-in ladder (see `featureFromConfig`). */
export function planFor(feature: PlanFeature): PlanId {
  return featureFrom[feature];
}

// ---- Features set from /admin ---------------------------------------------------

/** "on": by the plans' boxes. "test": the testers and the administrators only. "off": nobody (the emergency switch). */
export const featureModes = ["on", "test", "off"] as const;
export type FeatureMode = (typeof featureModes)[number];
export type FeatureStatus = { mode: FeatureMode; testers: string[] };

export type FeatureSettings = {
  /** The features of each plan, free and Admin included. */
  features: Record<PlanId, PlanFeature[]>;
  featureStatus: Record<PlanFeature, FeatureStatus>;
};

export const defaultFeatureSettings: FeatureSettings = {
  features: Object.fromEntries(planIds.map((plan) => [plan, planFeatures.filter((feature) => hasFeature(plan, feature))])) as Record<PlanId, PlanFeature[]>,
  featureStatus: Object.fromEntries(planFeatures.map((feature) => [feature, { mode: "on" as FeatureMode, testers: [] as string[] }])) as Record<PlanFeature, FeatureStatus>,
};


/**
 * Stored settings over the defaults. A record saved before these settings
 * existed gets the ladder. A feature added to the app after the record was
 * saved (absent from its `featureStatus`, which the Admin always saves whole)
 * gets its default plans, instead of being in none.
 */
export function withFeatureDefaults(stored: Partial<FeatureSettings> | null | undefined): FeatureSettings {
  const known = new Set(Object.keys(stored?.featureStatus ?? {}));
  const features = Object.fromEntries(
    planIds.map((plan) => {
      const saved = stored?.features?.[plan];
      if (!Array.isArray(saved)) return [plan, defaultFeatureSettings.features[plan]];
      return [plan, planFeatures.filter((feature) => (known.has(feature) ? saved.includes(feature) : hasFeature(plan, feature)))];
    }),
  ) as FeatureSettings["features"];
  const featureStatus = Object.fromEntries(
    planFeatures.map((feature) => {
      const saved = stored?.featureStatus?.[feature];
      const mode = saved && (featureModes as readonly string[]).includes(saved.mode) ? saved.mode : "on";
      const testers = Array.isArray(saved?.testers) ? [...new Set(saved.testers.filter((email): email is string => typeof email === "string").map((email) => email.trim().toLowerCase()))] : [];
      return [feature, { mode, testers }];
    }),
  ) as FeatureSettings["featureStatus"];
  return { features, featureStatus };
}

export type FeatureInput = {
  plan: PlanId;
  /** A plan created from the Admin (`ActivePlan.custom`): its own features, instead of `plan`'s. */
  custom?: string | null;
  /** The account's e-mail, for the testers; null when signed out. */
  email?: string | null;
  config: FeatureSettings & { customPlans?: readonly CustomPlan[] };
  /** The running subscription's own features (a difference from its plan); none: the plan as it is. */
  subscription?: { features?: FeatureDiff | null } | null;
  /** Features offered for a while (Admin → an account's card): only those running at `now` count. */
  grants?: ReadonlyArray<Pick<FeatureGrant, "feature" | "startsAt" | "endsAt">>;
  now?: number;
  /** Added for this account alone. */
  granted?: readonly PlanFeature[];
  /** Taken off for this account alone. */
  removed?: readonly PlanFeature[];
};

/** A subscription's own features: what it has on top of its plan, and what it goes without. */
export type FeatureDiff = { add: PlanFeature[]; remove: PlanFeature[] };

/** A subscription's own limits, each replacing its plan's (0 still means no limit). */
export type QuotaOverrides = Partial<PlanLimits>;
export const quotaKeys = ["scans", "questionsPerDay", "parcels", "deepPerMonth"] as const satisfies ReadonlyArray<keyof PlanLimits>;

/** A feature offered to an e-mail for a while, whatever its plan (supabase/migrations/0011). */
export type FeatureGrant = {
  id: string;
  email: string;
  feature: PlanFeature;
  /** ISO dates; `endsAt` is exclusive and always set: an offer stops by itself. */
  startsAt: string;
  endsAt: string;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
};

/** The offered features running at `now`, each with its latest end. */
export function runningGrants(grants: FeatureInput["grants"] = [], now = Date.now()): Map<PlanFeature, string> {
  const running = new Map<PlanFeature, string>();
  for (const grant of grants) {
    if (time(grant.startsAt) > now || time(grant.endsAt) <= now) continue;
    const known = running.get(grant.feature);
    if (!known || time(grant.endsAt) > time(known)) running.set(grant.feature, grant.endsAt);
  }
  return running;
}

/** The features an account would have by its plan and its own settings, before the states and the needs. */
function ownFeatures({ plan, custom, config, subscription, grants, now, granted = [], removed = [] }: FeatureInput): Set<PlanFeature> {
  const add = subscription?.features?.add ?? [];
  const remove = subscription?.features?.remove ?? [];
  const running = runningGrants(grants, now);
  const list = planListOf(config, custom ?? plan);
  return new Set(
    planFeatures.filter((feature) => {
      if (running.has(feature)) return true;
      const own = list.includes(feature) || add.includes(feature) || granted.includes(feature);
      return own && !remove.includes(feature) && !removed.includes(feature);
    }),
  );
}

/**
 * What an account may use right now: its plan's features, with its
 * subscription's own additions and removals and the features offered to it
 * for a while; then the features in test (testers and administrators only,
 * whatever was added or offered) and the switched-off ones (nobody), then
 * the features whose needs are missing.
 */
export function effectiveFeatures(input: FeatureInput): Set<PlanFeature> {
  const { plan, email, config } = input;
  const mail = email?.trim().toLowerCase() || null;
  const own = ownFeatures(input);
  const result = new Set<PlanFeature>();
  for (const feature of planFeatures) {
    const { mode, testers } = config.featureStatus[feature] ?? { mode: "on", testers: [] };
    if (mode === "off") continue;
    if (mode === "test") {
      if (isAdminPlan(plan) || (mail !== null && testers.includes(mail))) result.add(feature);
      continue;
    }
    if (own.has(feature)) result.add(feature);
  }
  // Drop what lacks a need, until nothing changes (a need may itself be dropped).
  for (let changed = true; changed; ) {
    changed = false;
    for (const feature of [...result]) {
      if (featureNeeds[feature]?.some((need) => !result.has(need))) {
        result.delete(feature);
        changed = true;
      }
    }
  }
  return result;
}

/** Why an account has a feature, or why not (Admin → an account's card). */
export type FeatureOrigin =
  /** Its plan has it. */
  | { kind: "plan"; on: true }
  /** Ticked on its subscription. */
  | { kind: "added"; on: true }
  /** Offered until `endsAt` (exclusive). */
  | { kind: "grant"; on: true; endsAt: string }
  /** In test: the testers and the administrators have it, nobody else. */
  | { kind: "test"; on: boolean }
  /** Switched off for everyone. */
  | { kind: "off"; on: false }
  /** Unticked on its subscription. */
  | { kind: "removed"; on: false }
  /** It would have it, but a feature it needs is missing. */
  | { kind: "missing"; on: false; needs: PlanFeature[] }
  /** Not in its plan. */
  | { kind: "notInPlan"; on: false };

export type FeatureLine = { feature: PlanFeature } & FeatureOrigin;

/** Every feature with whether the account has it and why: the same reckoning as `effectiveFeatures`. */
export function featureOrigins(input: FeatureInput): FeatureLine[] {
  const effective = effectiveFeatures(input);
  const { plan, custom, config, subscription, grants, now } = input;
  const planHas = (feature: PlanFeature) => planListOf(config, custom ?? plan).includes(feature);
  const add = subscription?.features?.add ?? [];
  const remove = subscription?.features?.remove ?? [];
  const running = runningGrants(grants, now);
  const own = ownFeatures(input);
  return planFeatures.map((feature): FeatureLine => {
    const mode = config.featureStatus[feature]?.mode ?? "on";
    if (mode === "off") return { feature, kind: "off", on: false };
    if (mode === "test") return { feature, kind: "test", on: effective.has(feature) };
    if (effective.has(feature)) {
      const kept = !remove.includes(feature);
      if (planHas(feature) && kept) return { feature, kind: "plan", on: true };
      if (add.includes(feature) && kept) return { feature, kind: "added", on: true };
      const endsAt = running.get(feature);
      return endsAt ? { feature, kind: "grant", on: true, endsAt } : { feature, kind: "plan", on: true };
    }
    if (own.has(feature)) return { feature, kind: "missing", on: false, needs: (featureNeeds[feature] ?? []).filter((need) => !effective.has(need)) };
    if (remove.includes(feature) && planHas(feature)) return { feature, kind: "removed", on: false };
    return { feature, kind: "notInPlan", on: false };
  });
}

/** A difference kept only where it differs: what the plan has is not added, what it lacks is not removed; null when nothing is left. */
export function normalizeDiff(planList: readonly PlanFeature[], diff: FeatureDiff | null | undefined): FeatureDiff | null {
  if (!diff) return null;
  const add = planFeatures.filter((feature) => diff.add.includes(feature) && !planList.includes(feature));
  const remove = planFeatures.filter((feature) => diff.remove.includes(feature) && planList.includes(feature));
  return add.length > 0 || remove.length > 0 ? { add, remove } : null;
}

/** The features a subscription has by its plan and its own difference (before the states and the needs). */
export function subscriptionFeatureList(planList: readonly PlanFeature[], diff: FeatureDiff | null | undefined): PlanFeature[] {
  return planFeatures.filter((feature) => (planList.includes(feature) || Boolean(diff?.add.includes(feature))) && !diff?.remove.includes(feature));
}

/** The difference that gives `wanted` on top of `planList`; null when they are the same. */
export function diffFor(planList: readonly PlanFeature[], wanted: readonly PlanFeature[]): FeatureDiff | null {
  return normalizeDiff(planList, { add: wanted.filter((feature) => !planList.includes(feature)), remove: planList.filter((feature) => !wanted.includes(feature)) });
}

/**
 * "Only new subscriptions and renewals": the difference that keeps what a
 * running subscription has now (its plan by `before`, its own difference)
 * once its plan becomes `after`; null when that is the plan again.
 */
export function keptDiff(before: readonly PlanFeature[], after: readonly PlanFeature[], diff: FeatureDiff | null | undefined): FeatureDiff | null {
  return diffFor(after, subscriptionFeatureList(before, diff));
}

/** Own limits kept only where they differ from the plan's; null when none is left. */
export function normalizeQuotas(base: PlanLimits, quotas: QuotaOverrides | null | undefined): QuotaOverrides | null {
  if (!quotas) return null;
  const kept: QuotaOverrides = {};
  for (const key of quotaKeys) {
    const value = quotas[key];
    if (typeof value === "number" && Number.isFinite(value) && value !== base[key]) kept[key] = value;
  }
  return Object.keys(kept).length > 0 ? kept : null;
}

/** The plan's limits with a subscription's own over them. The Admin plan stays without limits. */
export function withQuotas(plan: PlanId, base: PlanLimits, quotas: QuotaOverrides | null | undefined): PlanLimits {
  if (plan === "unlimited") return base;
  return { ...base, ...normalizeQuotas(base, quotas) };
}

/** The deep analyses a month when none is set: the smallest count of the paid plans, else 5. */
export function deepFallbackLimit(offers: Record<SoldPlanId, Pick<PlanLimits, "deepPerMonth">>): number {
  const counts = soldPlans.map((plan) => offers[plan].deepPerMonth).filter((count) => count > 0);
  return counts.length > 0 ? Math.min(...counts) : 5;
}

/**
 * The emergency cap: an account other than Admin that may use deep analyses
 * (its plan, its own, an offer) with no monthly count (0 = no limit, on the
 * costliest model) gets `deepFallbackLimit` instead. Checked whenever the
 * limits are reckoned, so a renewal or "back to the plan" never leaves an
 * offered access without a limit.
 */
export function withDeepFallback(
  plan: PlanId,
  limits: PlanLimits,
  features: ReadonlySet<PlanFeature> | undefined,
  offers: Record<SoldPlanId, Pick<PlanLimits, "deepPerMonth">>,
): { limits: PlanLimits; fallback: boolean } {
  if (plan === "unlimited" || !features?.has("deepAnalysis") || limits.deepPerMonth > 0) return { limits, fallback: false };
  return { limits: { ...limits, deepPerMonth: deepFallbackLimit(offers) }, fallback: true };
}

/**
 * Deep analyses on a subscription without a monthly count (0 = no limit),
 * because of its own settings (deep analyses ticked on it, or its count set
 * to 0): refused when saving, like `deepWithoutLimit` for a plan. Admin aside.
 */
export function subscriptionDeepWithoutLimit(
  plan: SubscriptionPlanId,
  config: Pick<PlansConfig, "features" | "offers"> & { customPlans?: readonly CustomPlan[] },
  diff: FeatureDiff | null | undefined,
  quotas: QuotaOverrides | null | undefined,
): boolean {
  const offer = planOfferOf(config, plan);
  if (plan === "unlimited" || !offer) return false;
  const deep = withQuotas("lite", offer, quotas).deepPerMonth;
  const has = subscriptionFeatureList(planListOf(config, plan), diff).includes("deepAnalysis");
  const own = Boolean(diff?.add.includes("deepAnalysis")) || quotas?.deepPerMonth === 0;
  return has && deep === 0 && own;
}

/** The features anyone on `plan` gets (no tester, nothing of their own): what the public pages announce. */
export function planFeatureList(plan: AnyPlanId, config: FeatureInput["config"]): PlanFeature[] {
  const created = customPlanOf(config, plan);
  const features = effectiveFeatures(created ? { plan: created.after, custom: created.id, config } : { plan: plan as PlanId, config });
  return planFeatures.filter((feature) => features.has(feature));
}

/**
 * The lowest plan that includes each feature, for the "from…" labels: null
 * when no plan does, or while it is in test or switched off. Built-in plans
 * only, for an older app; with `withCreated`, the plans created from the
 * Admin and on sale too, at their rank.
 */
export function featureFromConfig(config: FeatureInput["config"]): Record<PlanFeature, PlanId | null>;
export function featureFromConfig(config: FeatureInput["config"], withCreated: true): Record<PlanFeature, AnyPlanId | null>;
export function featureFromConfig(config: FeatureInput["config"], withCreated = false): Record<PlanFeature, AnyPlanId | null> {
  const created = withCreated ? (config.customPlans ?? []).filter((plan) => plan.onSale) : [];
  const candidates: AnyPlanId[] = [...planIds, ...created.map((plan) => plan.id)];
  const byPlan = candidates
    .map((plan) => [plan, new Set(planFeatureList(plan, config)), rankOf(plan, created)] as const)
    .sort(([, , a], [, , b]) => a - b);
  return Object.fromEntries(
    planFeatures.map((feature) => {
      if (config.featureStatus[feature]?.mode !== "on") return [feature, null];
      const lowest = byPlan.find(([, features]) => features.has(feature));
      return [feature, lowest ? lowest[0] : null];
    }),
  ) as Record<PlanFeature, AnyPlanId | null>;
}

/**
 * The plans with deep analyses ticked but no monthly count (0 means no
 * limit, on the costliest model): refused when saving. The Admin plan may
 * stay without a limit; free has no count of its own, so never. Created
 * plans are checked like the sold ones.
 */
export function deepWithoutLimit(config: Pick<PlansConfig, "features" | "offers"> & { customPlans?: readonly CustomPlan[] }): AnyPlanId[] {
  const builtIn = planIds.filter(
    (plan) => plan !== "unlimited" && config.features[plan].includes("deepAnalysis") && (plan === "free" || config.offers[plan].deepPerMonth === 0),
  );
  const created = (config.customPlans ?? []).filter((plan) => plan.features.includes("deepAnalysis") && plan.deepPerMonth === 0).map((plan) => plan.id);
  return [...builtIn, ...created];
}

/** Whether the plan the app knows allows a feature: the server's list, else the built-in ladder (older server, first start). */
export function planAllows(state: Pick<PlanResponse, "plan" | "features"> | null, feature: PlanFeature) {
  if (!state) return hasFeature("free", feature);
  return Array.isArray(state.features) ? state.features.includes(feature) : hasFeature(state.plan, feature);
}

/** The plan to suggest for a feature: the server's labels, else the built-in ladder; null when no plan has it. */
export function planSuggested(state: Pick<PlanResponse, "featureFrom"> | null, feature: PlanFeature): AnyPlanId | null {
  const from = state?.featureFrom;
  return from && feature in from ? (from[feature] ?? null) : featureFrom[feature];
}

/** One payment (or offered access) recorded by the owner. */
export type Subscription = {
  id: string;
  email: string;
  plan: SubscriptionPlanId;
  /** ISO dates; `endsAt` is exclusive, null for no end. */
  startsAt: string;
  endsAt: string | null;
  amountMga: number | null;
  paymentMethod: string | null;
  paymentRef: string | null;
  note: string | null;
  createdAt: string;
  // Missing before migration 0011: the plan as it is.
  /** Its own features, as a difference from its plan; null: the plan's. */
  features?: FeatureDiff | null;
  /** Its own limits; null: the plan's. */
  quotas?: QuotaOverrides | null;
};

export type ActivePlan = {
  /** A built-in plan: the subscription's, or for a created plan the built-in one just below it (what an older app knows). */
  plan: PlanId;
  /** Until when the plan runs without a gap, renewals included; null = no end. */
  endsAt: number | null;
  /** The plan created from the Admin the account is on (`CustomPlan.id`); missing or null on a built-in plan. */
  custom?: string | null;
};

const time = (iso: string) => new Date(iso).getTime();
const isActive = (row: Pick<Subscription, "startsAt" | "endsAt">, now: number) =>
  time(row.startsAt) <= now && (row.endsAt === null || time(row.endsAt) > now);

/**
 * The plan an email has at `now`: the highest one running, else free.
 * `created`: the plans created from the Admin, ranked among the built-in
 * ones; a row of a plan unknown to them (none passed, or deleted) is left out.
 */
export function activePlan(rows: Array<Pick<Subscription, "plan" | "startsAt" | "endsAt">>, now: number, created: readonly CustomPlanPlace[] = []): ActivePlan {
  const known = rows.filter((row) => rankOf(row.plan, created) >= 0);
  const active = known.filter((row) => isActive(row, now));
  if (active.length === 0) return { plan: "free", endsAt: null };
  const rank = (plan: SubscriptionPlanId) => rankOf(plan, created);
  const plan = active.reduce<SubscriptionPlanId>((best, row) => (rank(row.plan) > rank(best) ? row.plan : best), active[0].plan);

  // Follow renewals at the same level or above, each starting before the current end.
  const covering = known.filter((row) => rank(row.plan) >= rank(plan));
  let end = now;
  for (let extended = true; extended && end !== Infinity; ) {
    extended = false;
    for (const row of covering) {
      const rowEnd = row.endsAt === null ? Infinity : time(row.endsAt);
      if (time(row.startsAt) <= end && rowEnd > end) {
        end = rowEnd;
        extended = true;
      }
    }
  }
  const endsAt = end === Infinity ? null : end;
  const place = created.find((entry) => entry.id === plan);
  return place ? { plan: place.after, endsAt, custom: place.id } : { plan: plan as PaidPlanId, endsAt };
}

/**
 * The subscription whose own settings apply at `now`: among those running
 * at the plan the e-mail has, the latest started (a renewal, once begun).
 */
export function activeSubscription<T extends Pick<Subscription, "plan" | "startsAt" | "endsAt">>(rows: T[], now: number, created: readonly CustomPlanPlace[] = []): T | null {
  const current = activePlan(rows, now, created);
  if (current.plan === "free") return null;
  const plan = current.custom ?? current.plan;
  return rows.filter((row) => row.plan === plan && isActive(row, now)).sort((a, b) => time(b.startsAt) - time(a.startsAt))[0] ?? null;
}

export const durations = ["week", "month", "quarter", "half", "year", "none"] as const;
export type Duration = (typeof durations)[number];

/** End of a period starting at `start` (exclusive); null for no end. */
export function periodEnd(start: Date, duration: Duration): Date | null {
  if (duration === "none") return null;
  const end = new Date(start);
  if (duration === "week") end.setDate(end.getDate() + 7);
  else end.setMonth(end.getMonth() + { month: 1, quarter: 3, half: 6, year: 12 }[duration]);
  return end;
}

// ---- Offers -------------------------------------------------------------------

export type SoldPlanId = (typeof soldPlans)[number];

/** What a plan allows; 0 means no limit. */
export type PlanLimits = {
  /** Free: scans in total (the trial). Paid: scans per calendar month. */
  scans: number;
  questionsPerDay: number;
  /** Parcels followed at once. */
  parcels: number;
  /** Deep analyses per calendar month (plans with that feature). */
  deepPerMonth: number;
};

export type PlanOffer = PlanLimits & {
  priceMga: number;
  /** The price of a year paid at once (cheaper than twelve months). */
  yearPriceMga: number;
};

/** Prices, limits, how to pay and the features of each plan: editable from /admin. */
export type PlansConfig = FeatureSettings & {
  offers: Record<SoldPlanId, PlanOffer>;
  /** Parcels followed at once without a plan. */
  freeParcels: number;
  /** Shown on the offers page: the payment happens outside the app. */
  payment: { instructions: string; contact: string };
  /** The plans created from the Admin, each between two built-in ones (missing from an older record: none). */
  customPlans: CustomPlan[];
};

export const defaultPlansConfig: PlansConfig = {
  offers: {
    lite: { priceMga: 5000, yearPriceMga: 50000, scans: 60, questionsPerDay: 10, parcels: 15, deepPerMonth: 0 },
    premium: { priceMga: 15000, yearPriceMga: 150000, scans: 300, questionsPerDay: 50, parcels: 0, deepPerMonth: 30 },
    pro: { priceMga: 25000, yearPriceMga: 250000, scans: 600, questionsPerDay: 50, parcels: 0, deepPerMonth: 60 },
  },
  freeParcels: 3,
  payment: { instructions: "", contact: "" },
  customPlans: [],
  ...defaultFeatureSettings,
};

/** GET /api/plan: the user's plan, its limits and usage, and the offers. */
export type PlanResponse = {
  /** False in demo mode: nothing is counted. */
  enabled: boolean;
  signedIn: boolean;
  /** Always a built-in plan: on a created plan, the one just below it (see `customPlan`). */
  plan: PlanId;
  endsAt: number | null;
  limits: PlanLimits;
  usage: { scans: number; questionsToday: number; deep: number };
  /**
   * Each offer, with the features anyone on it gets (none in test nor
   * switched off). The created plans on sale (and the account's own) only for
   * an app that asks for them (header `x-plans: all`), with their name, colour and rank.
   */
  offers: Array<PlanOffer & { id: AnyPlanId; features?: PlanFeature[] } & Partial<CustomPlanInfo>>;
  /** The created plan the account is on; null on a built-in plan (missing from an older server). */
  customPlan?: CustomPlanInfo | null;
  payment: PlansConfig["payment"];
  // Missing from an older server or cache: treated as false / none.
  /** Signed in and never had a trial nor Premium: may start the 7-day Premium trial. */
  trialEligible?: boolean;
  /** A discount code waiting for the next payment. */
  discount?: { code: string; percent: number } | null;
  /** The account's referral code, to share. */
  referralCode?: string | null;
  /** What this account may use (the Admin settings applied); missing: the built-in ladder. */
  features?: PlanFeature[];
  /** The lowest plan with each feature, for the "from…" labels; null: no plan has it now. A created plan only for `x-plans: all`. */
  featureFrom?: Partial<Record<PlanFeature, AnyPlanId | null>>;
  /** What the account paid for its subscriptions (amount known only), for "Mes dépenses". */
  payments?: SubscriptionPayment[];
  /** The features offered to this account for a while, running now (Admin → its card). */
  grants?: Array<{ feature: PlanFeature; endsAt: number }>;
};

export type SubscriptionPayment = { id: string; plan: SubscriptionPlanId; amountMga: number; paidAt: number };

/** The subscriptions paid, with their amount, the latest first (24 at most); the day paid is taken as the day it starts. */
export function subscriptionPayments(rows: Array<Pick<Subscription, "id" | "plan" | "startsAt" | "amountMga">>): SubscriptionPayment[] {
  return rows
    .flatMap((row) => {
      const paidAt = Date.parse(row.startsAt);
      return row.amountMga && row.amountMga > 0 && Number.isFinite(paidAt) ? [{ id: row.id, plan: row.plan, amountMga: Math.round(row.amountMga), paidAt }] : [];
    })
    .sort((a, b) => b.paidAt - a.paidAt)
    .slice(0, 24);
}

// ---- Plans created from the Admin ----------------------------------------------
// The built-in plans stay as they are; a created plan sits right after one of
// the sold ones and before the next, with its own name, colour, price, limits
// and features. An older app only knows the built-in ids: the server tells it
// the built-in plan just below (`ActivePlan.plan`), and goes itself by the
// created plan (`ActivePlan.custom`) for what the account may use.

/** Sent by an app that knows the created plans, with "all": GET /api/plan then lists them too. */
export const allPlansHeader = "x-plans";

/** A built-in plan's id, or a created plan's (`CustomPlan.id`). */
export type AnyPlanId = PlanId | (string & {});
/** What a subscription records: a built-in paid plan, or a created one. */
export type SubscriptionPlanId = PaidPlanId | (string & {});

/** Where a created plan may sit: right after one of these, before the next built-in plan. */
export const customPlanSlots = ["lite", "premium", "pro"] as const;
export type CustomPlanSlot = (typeof customPlanSlots)[number];

/** The colours a created plan may take, readable on the light and the dark theme (styles/planColors.scss). */
export const customPlanColors = ["teal", "emerald", "rose", "orange", "indigo", "slate"] as const;
export type CustomPlanColor = (typeof customPlanColors)[number];

/** A created plan's id: short, lowercase, fixed once created (also checked by migration 0015). */
export const customPlanIdPattern = /^[a-z][a-z0-9-]{1,23}$/;

/** The name typed by the Admin, in each language of the app (data, not a translation key). */
export type PlanName = { fr: string; en: string };

export type CustomPlan = PlanOffer & {
  id: string;
  name: PlanName;
  color: CustomPlanColor;
  after: CustomPlanSlot;
  features: PlanFeature[];
  /** Off sale: no longer offered nor recorded anew; its running subscriptions keep it until they end. */
  onSale: boolean;
  createdAt: number;
};

/** What ranks a created plan: its slot, then its place in the list among the plans of the same slot. */
export type CustomPlanPlace = Pick<CustomPlan, "id" | "after">;

/** What the app shows of a created plan. */
export type CustomPlanInfo = { id: string; name: PlanName; color: CustomPlanColor; rank: number };

const builtInIds: readonly string[] = planIds;

/** Whether `id` can name a created plan: the right form, and not a built-in plan. */
export function isCustomPlanId(id: string) {
  return customPlanIdPattern.test(id) && !builtInIds.includes(id);
}

/**
 * A plan's rank: the built-in ones keep theirs (free 0 … Admin 4); a created
 * plan comes between its slot and the next built-in plan, in the order of the
 * list. -1 for an id none of them has (a plan deleted since).
 */
export function rankOf(plan: AnyPlanId, created: readonly CustomPlanPlace[] = []): number {
  if (builtInIds.includes(plan)) return planRank[plan as PlanId];
  const place = created.find((entry) => entry.id === plan);
  if (!place) return -1;
  const siblings = created.filter((entry) => entry.after === place.after);
  return planRank[place.after] + (siblings.indexOf(place) + 1) / (siblings.length + 1);
}

/** The created plan with this id, if any. */
export function customPlanOf(config: { customPlans?: readonly CustomPlan[] }, plan: AnyPlanId | null | undefined): CustomPlan | null {
  return (plan && config.customPlans?.find((entry) => entry.id === plan)) || null;
}

/** A plan's own features (before the states and the needs): a created plan's, else the Admin table's. */
export function planListOf(config: Pick<FeatureSettings, "features"> & { customPlans?: readonly CustomPlan[] }, plan: AnyPlanId): readonly PlanFeature[] {
  return customPlanOf(config, plan)?.features ?? config.features[plan as PlanId] ?? [];
}

/** A paid plan's price and limits: a sold or a created plan's; null for Admin, free or an unknown id. */
export function planOfferOf(config: Pick<PlansConfig, "offers"> & { customPlans?: readonly CustomPlan[] }, plan: AnyPlanId): PlanOffer | null {
  const created = customPlanOf(config, plan);
  if (created) return created;
  return (soldPlans as readonly string[]).includes(plan) ? config.offers[plan as SoldPlanId] : null;
}

/** What the app shows of a created plan. */
export function customPlanInfo(plan: CustomPlan, created: readonly CustomPlanPlace[]): CustomPlanInfo {
  return { id: plan.id, name: plan.name, color: plan.color, rank: rankOf(plan.id, created) };
}

/**
 * A created plan's limits as a subscription's own (`withQuotas` over the
 * built-in plan just below), with the subscription's own over them: what the
 * server counts by. On a built-in plan, the subscription's own alone.
 */
export function createdQuotas(config: { customPlans?: readonly CustomPlan[] }, custom: string | null | undefined, own: QuotaOverrides | null | undefined): QuotaOverrides | null {
  const created = customPlanOf(config, custom);
  if (!created) return own ?? null;
  const { scans, questionsPerDay, parcels, deepPerMonth } = created;
  return { scans, questionsPerDay, parcels, deepPerMonth, ...own };
}

/** Why a created plan can't be deleted: someone has it running or starting later (then it can only go off sale). */
export function customPlanInUse(plan: string, rows: ReadonlyArray<Pick<Subscription, "plan" | "endsAt">>, now: number) {
  return rows.some((row) => row.plan === plan && (row.endsAt === null || time(row.endsAt) > now));
}
