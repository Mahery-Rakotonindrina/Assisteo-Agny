import { useEffect, useState } from "react";
import { hasOwnExpenses } from "@/lib/expenses";
import { expenseStore, type ExpenseRecord } from "@/services/expenseStore";

/** "Mes dépenses", kept up to date. */
export function useExpenses() {
  const [records, setRecords] = useState<ExpenseRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void expenseStore.list().then((all) => {
        if (cancelled) return;
        setRecords(all);
        setIsLoading(false);
      });
    load();
    const unsubscribe = expenseStore.subscribe(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { records, isLoading };
}

/**
 * Own expenses kept on the device (the synced ones included), checked only
 * when `enabled`: without "Mes dépenses", the menu keeps a link to their
 * read-only history. False on the server and at hydration: the link only
 * appears once mounted.
 */
export function useKeptExpenses(enabled: boolean) {
  const [kept, setKept] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = () =>
      void expenseStore.list().then((all) => {
        if (!cancelled) setKept(hasOwnExpenses(all));
      });
    load();
    const unsubscribe = expenseStore.subscribe(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [enabled]);

  return enabled && kept;
}
