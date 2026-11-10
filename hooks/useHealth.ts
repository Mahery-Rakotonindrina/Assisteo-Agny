import { useEffect, useState } from "react";
import { isHealthScan } from "@/lib/health";
import { historyStore } from "@/services/historyStore";

/**
 * Whether there is anything for "Ma santé" (a prescription or a medicine box
 * scanned, a treatment): its link only shows then. False until read.
 */
export function useHasHealth() {
  const [has, setHas] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void historyStore
        .list()
        .then((entries) => {
          if (!cancelled) setHas(entries.some(isHealthScan));
        })
        .catch(() => undefined);
    load();
    const unsubscribe = historyStore.subscribe(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return has;
}
