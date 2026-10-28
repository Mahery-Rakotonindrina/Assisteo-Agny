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
  | "expenses";

/** Every feature, in the order of the Admin table and of the offers page. */
export const planFeatures = ["reminders", "parcelCosts", "pdfExport", "ownKey", "deepAnalysis", "multiPage", "garage", "reseller", "expenses"] as const satisfies readonly PlanFeature[];
// Fails to compile when a feature is missing from the list.
const everyFeatureListed: Exclude<PlanFeature, (typeof planFeatures)[number]> extends never ? true : never = true;
void everyFeatureListed;

/**
 * The built-in ladder: the lowest plan that includes each feature. It is the
 * default of the Admin settings (`PlansConfig.features`), and what an app
 * goes by until the server sent its settings (an older APK keeps it).
 */
const featureFrom: Record<PlanFeature, PlanId> = { ownKey: "lite", parcelCosts: "lite", reseller: "pro", deepAnalysis: "premium", multiPage: "premium", pdfExport: "lite", garage: "premium", reminders: "lite", expenses: "unlimited" };

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
  /** The account's e-mail, for the testers; null when signed out. */
  email?: string | null;
  config: FeatureSettings;
  // Lot B: the subscription's own list, and temporary access, go here.
  /** Added for this account alone (its subscription, a temporary access). */
  granted?: readonly PlanFeature[];
  /** Taken off for this account alone. */
  removed?: readonly PlanFeature[];
};

/**
 * What an account may use right now: its plan's features (with its own
 * additions and removals), then the features in test (testers and
 * administrators only) and the switched-off ones (nobody), then the
 * features whose needs are missing.
 */
export function effectiveFeatures({ plan, email, config, granted = [], removed = [] }: FeatureInput): Set<PlanFeature> {
  const mail = email?.trim().toLowerCase() || null;
  const result = new Set<PlanFeature>();
  for (const feature of planFeatures) {
    const { mode, testers } = config.featureStatus[feature] ?? { mode: "on", testers: [] };
    if (mode === "off") continue;
    if (mode === "test") {
      if (isAdminPlan(plan) || (mail !== null && testers.includes(mail))) result.add(feature);
      continue;
    }
    const own = config.features[plan]?.includes(feature) || granted.includes(feature);
    if (own && !removed.includes(feature)) result.add(feature);
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

/** The features anyone on `plan` gets (no tester, nothing of their own): what the public pages announce. */
export function planFeatureList(plan: PlanId, config: FeatureSettings): PlanFeature[] {
  const features = effectiveFeatures({ plan, config });
  return planFeatures.filter((feature) => features.has(feature));
}

/**
 * The lowest plan that includes each feature, for the "from…" labels: null
 * when no plan does, or while it is in test or switched off.
 */
export function featureFromConfig(config: FeatureSettings): Record<PlanFeature, PlanId | null> {
  const byPlan = planIds.map((plan) => [plan, effectiveFeatures({ plan, config })] as const);
  return Object.fromEntries(
    planFeatures.map((feature) => {
      if (config.featureStatus[feature]?.mode !== "on") return [feature, null];
      const lowest = [...byPlan].sort(([a], [b]) => planRank[a] - planRank[b]).find(([, features]) => features.has(feature));
      return [feature, lowest ? lowest[0] : null];
    }),
  ) as Record<PlanFeature, PlanId | null>;
}

/**
 * The plans with deep analyses ticked but no monthly count (0 means no
 * limit, on the costliest model): refused when saving. The Admin plan may
 * stay without a limit; free has no count of its own, so never.
 */
export function deepWithoutLimit(config: Pick<PlansConfig, "features" | "offers">): PlanId[] {
  return planIds.filter(
    (plan) => plan !== "unlimited" && config.features[plan].includes("deepAnalysis") && (plan === "free" || config.offers[plan].deepPerMonth === 0),
  );
}

/** Whether the plan the app knows allows a feature: the server's list, else the built-in ladder (older server, first start). */
export function planAllows(state: Pick<PlanResponse, "plan" | "features"> | null, feature: PlanFeature) {
  if (!state) return hasFeature("free", feature);
  return Array.isArray(state.features) ? state.features.includes(feature) : hasFeature(state.plan, feature);
}

/** The plan to suggest for a feature: the server's labels, else the built-in ladder; null when no plan has it. */
export function planSuggested(state: Pick<PlanResponse, "featureFrom"> | null, feature: PlanFeature): PlanId | null {
  const from = state?.featureFrom;
  return from && feature in from ? (from[feature] ?? null) : featureFrom[feature];
}

/** One payment (or offered access) recorded by the owner. */
export type Subscription = {
  id: string;
  email: string;
  plan: PaidPlanId;
  /** ISO dates; `endsAt` is exclusive, null for no end. */
  startsAt: string;
  endsAt: string | null;
  amountMga: number | null;
  paymentMethod: string | null;
  paymentRef: string | null;
  note: string | null;
  createdAt: string;
};

export type ActivePlan = {
  plan: PlanId;
  /** Until when the plan runs without a gap, renewals included; null = no end. */
  endsAt: number | null;
};

const time = (iso: string) => new Date(iso).getTime();
const isActive = (row: Pick<Subscription, "startsAt" | "endsAt">, now: number) =>
  time(row.startsAt) <= now && (row.endsAt === null || time(row.endsAt) > now);

/** The plan an email has at `now`: the highest one running, else free. */
export function activePlan(rows: Array<Pick<Subscription, "plan" | "startsAt" | "endsAt">>, now: number): ActivePlan {
  const active = rows.filter((row) => isActive(row, now));
  if (active.length === 0) return { plan: "free", endsAt: null };
  const plan = active.reduce<PaidPlanId>((best, row) => (planRank[row.plan] > planRank[best] ? row.plan : best), active[0].plan);

  // Follow renewals at the same level or above, each starting before the current end.
  const covering = rows.filter((row) => planRank[row.plan] >= planRank[plan]);
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
  return { plan, endsAt: end === Infinity ? null : end };
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
};

export const defaultPlansConfig: PlansConfig = {
  offers: {
    lite: { priceMga: 5000, yearPriceMga: 50000, scans: 60, questionsPerDay: 10, parcels: 15, deepPerMonth: 0 },
    premium: { priceMga: 15000, yearPriceMga: 150000, scans: 300, questionsPerDay: 50, parcels: 0, deepPerMonth: 30 },
    pro: { priceMga: 25000, yearPriceMga: 250000, scans: 600, questionsPerDay: 50, parcels: 0, deepPerMonth: 60 },
  },
  freeParcels: 3,
  payment: { instructions: "", contact: "" },
  ...defaultFeatureSettings,
};

/** GET /api/plan: the user's plan, its limits and usage, and the offers. */
export type PlanResponse = {
  /** False in demo mode: nothing is counted. */
  enabled: boolean;
  signedIn: boolean;
  plan: PlanId;
  endsAt: number | null;
  limits: PlanLimits;
  usage: { scans: number; questionsToday: number; deep: number };
  /** Each offer, with the features anyone on it gets (none in test nor switched off). */
  offers: Array<PlanOffer & { id: SoldPlanId; features?: PlanFeature[] }>;
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
  /** The lowest plan with each feature, for the "from…" labels; null: no plan has it now. */
  featureFrom?: Partial<Record<PlanFeature, PlanId | null>>;
};
