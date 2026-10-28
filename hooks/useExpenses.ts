import { useEffect, useState } from "react";
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
