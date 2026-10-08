import { useEffect, useSyncExternalStore } from "react";
import { hasFeature, isAdminPlan, type PlanFeature } from "@/lib/plans";
import { planStore } from "@/services/plan";

let requested = false;

/**
 * The user's plan and what it allows. Null until known (first launch
 * offline): callers then behave as on the free plan.
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
    has: (feature: PlanFeature) => hasFeature(id, feature),
    /** An administrator (full access): the Admin menu is shown. */
    isAdmin: isAdminPlan(id),
    /** The plan was checked with the server since the app opened. */
    fresh,
  };
}
