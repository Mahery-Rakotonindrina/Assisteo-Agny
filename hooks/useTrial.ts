import { useEffect, useState } from "react";
import { aiKeyStore } from "@/services/aiKeyStore";
import { usePlan } from "./usePlan";

/**
 * Scans left on the app's AI: the free trial (in total) or the plan (this
 * month). `limited` is false when nothing is counted (an own key the plan
 * allows, full access, demo mode, or the plan not known yet), in which case
 * nothing should be shown.
 */
export function useTrial() {
  const { plan, id, has } = usePlan();
  const [hasOwnKey, setHasOwnKey] = useState<boolean | null>(null);

  useEffect(() => {
    const load = () => void aiKeyStore.get().then((override) => setHasOwnKey(Boolean(override)));
    load();
    return aiKeyStore.subscribe(load);
  }, []);

  const canUseOwnKey = has("ownKey");
  const limit = plan?.limits.scans ?? 0;
  const limited = Boolean(plan?.enabled) && hasOwnKey !== null && !(hasOwnKey && canUseOwnKey) && limit > 0;
  const remaining = limited && plan ? Math.max(0, limit - plan.usage.scans) : null;

  return {
    limited,
    /** "trial": free scans in total; "month": the plan's scans this month. */
    kind: id === "free" ? ("trial" as const) : ("month" as const),
    plan: id,
    limit: limited ? limit : null,
    remaining,
    exhausted: limited && remaining === 0,
    canUseOwnKey,
  };
}
