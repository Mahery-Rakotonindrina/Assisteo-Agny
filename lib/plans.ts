// Plans: free (the trial), the three sold ones, and an access offered by the
// owner (family). They form a ladder: each plan includes everything below it.
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
  | "reseller";

/** The lowest plan that includes each feature. */
const featureFrom: Record<PlanFeature, PlanId> = { ownKey: "lite", parcelCosts: "lite", reseller: "pro" };

export function hasFeature(plan: PlanId, feature: PlanFeature) {
  return planRank[plan] >= planRank[featureFrom[feature]];
}

/** The plan to suggest for a feature the user doesn't have. */
export function planFor(feature: PlanFeature): PlanId {
  return featureFrom[feature];
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
