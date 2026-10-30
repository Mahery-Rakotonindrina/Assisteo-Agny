import { useEffect, useSyncExternalStore } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { createdPlanInfo, planName } from "@/lib/customPlans";
import { isAdminPlan, planAllows, planSuggested, type AnyPlanId, type PlanFeature } from "@/lib/plans";
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
  const { t, locale } = useTranslation();
  const fresh = useSyncExternalStore(planStore.subscribe, planStore.isFresh, () => false);

  useEffect(() => {
    if (requested) return;
    requested = true;
    void planStore.refresh();
  }, []);

  const id = plan?.plan ?? "free";
  // A created plan's id (Admin → Offers), else the built-in plan's.
  const current: AnyPlanId = plan?.customPlan?.id ?? id;
  return {
    plan,
    /** Always a built-in plan: on a created plan, the one just below it. */
    id,
    /** The plan the account is on, created plans included (for its name and colour). */
    current,
    /** A plan's name, created plans included; the account's own by default. */
    name: (of: AnyPlanId = current) => planName(of, t, locale, plan),
    /** A created plan's colour, for `data-plan-color` (undefined for a built-in plan); the account's own by default. */
    color: (of: AnyPlanId | null = current) => (of === null ? undefined : createdPlanInfo(of, plan)?.color),
    has: (feature: PlanFeature) => planAllows(plan, feature),
    /** The plan to suggest for a feature the user doesn't have; null when no plan offers it now. */
    planFor: (feature: PlanFeature) => planSuggested(plan, feature),
    /** An administrator (full access): the Admin menu is shown. */
    isAdmin: isAdminPlan(id),
    /** The plan was checked with the server since the app opened. */
    fresh,
  };
}
