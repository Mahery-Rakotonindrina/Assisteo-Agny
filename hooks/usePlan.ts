import { useEffect, useSyncExternalStore } from "react";
import { isAdminPlan, planAllows, planSuggested, type PlanFeature } from "@/lib/plans";
import { planStore } from "@/services/plan";

let requested = false;

/**
 * The user's plan and what it allows. Null until known (first launch
 * offline, and always at the first render: no hydration gap): callers then
 * behave as on the free plan. What it allows, and the plan each feature
 * starts from, are the server's (the Admin settings, remembered offline);
 * the built-in ladder until it answered.
 */
export function usePlan() {
  const plan = useSyncExternalStore(planStore.subscribe, planStore.get, () => null);
  const fresh = useSyncExternalStore(planStore.subscribe, planStore.isFresh, () => false);

  useEffect(() => {
    if (requested) return;
    requested = true;
    void planStore.refresh();
  }, []);

  const id = plan?.plan ?? "free";
  return {
    plan,
    id,
    has: (feature: PlanFeature) => planAllows(plan, feature),
    /** The plan to suggest for a feature the user doesn't have; null when no plan offers it now. */
    planFor: (feature: PlanFeature) => planSuggested(plan, feature),
    /** An administrator (full access): the Admin menu is shown. */
    isAdmin: isAdminPlan(id),
    /** The plan was checked with the server since the app opened. */
    fresh,
  };
}
