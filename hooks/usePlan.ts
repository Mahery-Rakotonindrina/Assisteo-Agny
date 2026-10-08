import { useEffect, useSyncExternalStore } from "react";
import { hasFeature, type PlanFeature } from "@/lib/plans";
import { planStore } from "@/services/plan";

let requested = false;

/**
 * The user's plan and what it allows. Null until known (first launch
 * offline): callers then behave as on the free plan.
 */
export function usePlan() {
  const plan = useSyncExternalStore(planStore.subscribe, planStore.get, () => null);

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
  };
}
