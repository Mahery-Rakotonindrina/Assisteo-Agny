import { planFor, type PlanFeature, type PlanId, type PlanResponse } from "./plans";

/** The plan features the discover page presents, in its order (the own AI key is left to the offers page). */
export const discoverFeatures = ["reminders", "pdfExport", "parcelCosts", "multiPage", "deepAnalysis", "garage", "inventory", "plants", "reseller", "expenses", "loans"] as const satisfies readonly PlanFeature[];
export type DiscoverFeature = (typeof discoverFeatures)[number];

/** A card: the feature, and the lowest plan with it for the "from…" label (null: no label yet). */
export type DiscoverCard = { feature: DiscoverFeature; from: PlanId | null };

// Announced only when a plan anyone can get has it: not switched off, not in test, not Admin only.
const announced = (plan: PlanId | null): plan is PlanId => plan !== null && plan !== "unlimited";

/**
 * The cards to show. Before the settings are known (`from` null: the static
 * HTML, and the first render in the browser), the built-in ladder without
 * labels, so the page reads the same for search engines and hydrates as is.
 * Then the server's labels; a feature missing from them (older server) keeps
 * its built-in plan.
 */
export function discoverCards(from: PlanResponse["featureFrom"] | null): DiscoverCard[] {
  if (!from) return discoverFeatures.filter((feature) => announced(planFor(feature))).map((feature) => ({ feature, from: null }));
  return discoverFeatures.flatMap((feature) => {
    const plan = feature in from ? (from[feature] ?? null) : planFor(feature);
    return announced(plan) ? [{ feature, from: plan }] : [];
  });
}
