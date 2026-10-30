import {
  activePlan,
  activeSubscription,
  diffFor,
  featureDependents,
  featureNeeds,
  keptDiff,
  paidPlans,
  planFeatures,
  planIds,
  subscriptionFeatureList,
  type FeatureDiff,
  type FeatureMode,
  type FeatureSettings,
  type PaidPlanId,
  type PlanFeature,
  type PlanId,
  type Subscription,
} from "./plans";

// Admin → Offers, the features table: what a save changes (shown before it,
// and written to the admin log), and who it touches.

export type FeatureChange =
  | { kind: "plan"; plan: PlanId; added: PlanFeature[]; removed: PlanFeature[] }
  | { kind: "status"; feature: PlanFeature; from: FeatureMode; to: FeatureMode; testers: number };

/** The changes from `before` to `after`: per plan, the features ticked and unticked; per feature, its state (and its testers while in test). */
export function featureChanges(before: FeatureSettings, after: FeatureSettings): FeatureChange[] {
  const changes: FeatureChange[] = [];
  for (const plan of planIds) {
    const was = new Set(before.features[plan]);
    const now = new Set(after.features[plan]);
    const added = planFeatures.filter((feature) => now.has(feature) && !was.has(feature));
    const removed = planFeatures.filter((feature) => was.has(feature) && !now.has(feature));
    if (added.length > 0 || removed.length > 0) changes.push({ kind: "plan", plan, added, removed });
  }
  for (const feature of planFeatures) {
    const from = before.featureStatus[feature];
    const to = after.featureStatus[feature];
    const testersChanged = to.mode === "test" && [...from.testers].sort().join(",") !== [...to.testers].sort().join(",");
    if (from.mode !== to.mode || testersChanged) changes.push({ kind: "status", feature, from: from.mode, to: to.mode, testers: to.testers.length });
  }
  return changes;
}

/** One line of the admin log: "premium: +garage -multiPage", "garage: on -> off". */
export function describeChange(change: FeatureChange): string {
  if (change.kind === "plan") return `${change.plan}: ${[...change.added.map((feature) => `+${feature}`), ...change.removed.map((feature) => `-${feature}`)].join(" ")}`;
  return `${change.feature}: ${change.from} -> ${change.to}${change.to === "test" ? ` (${change.testers} testers)` : ""}`;
}

/** The features to untick with `feature` in a plan: those ticked there that need it. */
export function untickAlso(settings: FeatureSettings, plan: PlanId, feature: PlanFeature): PlanFeature[] {
  return featureDependents(feature).filter((other) => settings.features[plan].includes(other));
}

/** The features to tick with `feature` in a plan: its needs not ticked there. */
export function tickAlso(settings: FeatureSettings, plan: PlanId, feature: PlanFeature): PlanFeature[] {
  const wanted = new Set<PlanFeature>();
  const visit = (current: PlanFeature) => {
    for (const need of featureNeeds[current] ?? []) {
      if (!wanted.has(need)) {
        wanted.add(need);
        visit(need);
      }
    }
  };
  visit(feature);
  return planFeatures.filter((other) => wanted.has(other) && !settings.features[plan].includes(other));
}

/** Ticks or unticks features in one plan, the others kept in their order. */
export function setPlanFeatures(settings: FeatureSettings, plan: PlanId, features: readonly PlanFeature[], on: boolean): FeatureSettings {
  const current = new Set(settings.features[plan]);
  for (const feature of features) {
    if (on) current.add(feature);
    else current.delete(feature);
  }
  return { ...settings, features: { ...settings.features, [plan]: planFeatures.filter((feature) => current.has(feature)) } };
}

/**
 * The accounts on each paid plan right now (their highest running
 * subscription), from every recorded subscription. The plans created from
 * the Admin are not columns of the features table: their subscriptions are
 * left out here (and below), their features being their plan's own.
 */
export function activeSubscriberCounts(rows: Array<Pick<Subscription, "email" | "plan" | "startsAt" | "endsAt">>, now: number): Record<PaidPlanId, number> {
  const byEmail = new Map<string, typeof rows>();
  for (const row of rows) {
    const email = row.email.toLowerCase();
    byEmail.set(email, [...(byEmail.get(email) ?? []), row]);
  }
  const counts = Object.fromEntries(paidPlans.map((plan) => [plan, 0])) as Record<PaidPlanId, number>;
  for (const own of byEmail.values()) {
    const { plan } = activePlan(own, now);
    if (plan !== "free") counts[plan] += 1;
  }
  return counts;
}

/** How a change of a plan's features applies: to everyone on it (the default), or only to the subscriptions recorded from now on. */
export const applyModes = ["all", "new"] as const;
export type ApplyMode = (typeof applyModes)[number];

/**
 * "Only new subscriptions and renewals": for each e-mail with a subscription
 * running now on a plan whose features change, the own difference that keeps
 * what it has. Only the subscriptions whose difference changes are listed.
 */
export function keepRunningRights(
  before: FeatureSettings["features"],
  after: FeatureSettings["features"],
  rows: Array<Pick<Subscription, "id" | "email" | "plan" | "startsAt" | "endsAt" | "features">>,
  now: number,
): Array<{ id: string; email: string; plan: PaidPlanId; features: FeatureDiff | null }> {
  const byEmail = new Map<string, typeof rows>();
  for (const row of rows) {
    const email = row.email.toLowerCase();
    byEmail.set(email, [...(byEmail.get(email) ?? []), row]);
  }
  const updates: ReturnType<typeof keepRunningRights> = [];
  for (const [email, own] of byEmail) {
    const running = activeSubscription(own, now);
    if (!running) continue;
    // Built-in here: without the created plans, `activeSubscription` leaves their rows out.
    const plan = running.plan as PaidPlanId;
    const was = before[plan];
    const will = after[plan];
    if (was.length === will.length && was.every((feature) => will.includes(feature))) continue;
    const features = keptDiff(was, will, running.features);
    if (JSON.stringify(features) !== JSON.stringify(running.features ?? null)) updates.push({ id: running.id, email, plan, features });
  }
  return updates;
}

/** One line of the admin log for a subscription's own settings: "+garage -pdfExport · scans 100". */
export function describeOwn(features: FeatureDiff | null | undefined, quotas: Partial<Record<string, number>> | null | undefined): string {
  const parts = [...(features?.add ?? []).map((feature) => `+${feature}`), ...(features?.remove ?? []).map((feature) => `-${feature}`)];
  const limits = Object.entries(quotas ?? {}).map(([key, value]) => `${key} ${value}`);
  return [parts.join(" "), limits.join(", ")].filter(Boolean).join(" · ");
}

/** Ticking a feature ticks what it needs; unticking one unticks what needs it. */
export function toggleOwnFeature(planList: readonly PlanFeature[], diff: FeatureDiff | null, feature: PlanFeature, on: boolean): FeatureDiff | null {
  const wanted = new Set(subscriptionFeatureList(planList, diff));
  const visit = (current: PlanFeature) => {
    for (const need of featureNeeds[current] ?? []) {
      if (!wanted.has(need)) {
        wanted.add(need);
        visit(need);
      }
    }
  };
  if (on) {
    wanted.add(feature);
    visit(feature);
  } else {
    for (const other of [feature, ...featureDependents(feature)]) wanted.delete(other);
  }
  return diffFor(planList, [...wanted]);
}
