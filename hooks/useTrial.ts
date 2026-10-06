import { useEffect, useState } from "react";
import { aiKeyStore } from "@/services/aiKeyStore";
import { trialStore } from "@/services/trial";

/**
 * Free trial on the server's AI. `limited` is false once the user has their
 * own key (or in demo mode), in which case nothing should be shown.
 */
export function useTrial() {
  const [trial, setTrial] = useState(trialStore.get);
  const [hasOwnKey, setHasOwnKey] = useState<boolean | null>(null);

  useEffect(() => {
    const unsubscribe = trialStore.subscribe(() => setTrial(trialStore.get()));
    void trialStore.refresh();
    return unsubscribe;
  }, []);

  useEffect(() => {
    const load = () => void aiKeyStore.get().then((override) => setHasOwnKey(Boolean(override)));
    load();
    return aiKeyStore.subscribe(load);
  }, []);

  const limited = Boolean(trial?.enabled) && hasOwnKey === false;
  const remaining = trial ? Math.max(0, trial.limit - trial.used) : null;

  return {
    limited,
    limit: trial?.limit ?? null,
    remaining,
    exhausted: limited && remaining === 0,
  };
}
