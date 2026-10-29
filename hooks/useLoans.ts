import { useEffect, useState } from "react";
import { loanStore, type Loan } from "@/services/loanStore";

/** "Prêts", kept up to date. */
export function useLoans() {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void loanStore.list().then((all) => {
        if (cancelled) return;
        setLoans(all);
        setIsLoading(false);
      });
    load();
    const unsubscribe = loanStore.subscribe(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { loans, isLoading };
}

/**
 * Loans kept on the device, checked only when `enabled`: without "Prêts",
 * the menu keeps a link to them, read only. False on the server and at
 * hydration: the link only appears once mounted.
 */
export function useKeptLoans(enabled: boolean) {
  const [kept, setKept] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = () =>
      void loanStore.list().then((all) => {
        if (!cancelled) setKept(all.length > 0);
      });
    load();
    const unsubscribe = loanStore.subscribe(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [enabled]);

  return enabled && kept;
}
