import { useEffect, useState } from "react";
import { healthSpendStore, type HealthSpend } from "@/services/healthSpendStore";

/** Ma santé's own health expenses (without "Mes dépenses"), kept up to date. */
export function useHealthSpending() {
  const [spends, setSpends] = useState<HealthSpend[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void healthSpendStore.list().then((all) => {
        if (cancelled) return;
        setSpends(all);
        setIsLoading(false);
      });
    load();
    const unsubscribe = healthSpendStore.subscribe(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { spends, isLoading };
}
