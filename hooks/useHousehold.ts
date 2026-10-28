import { useEffect, useState, useSyncExternalStore } from "react";
import type { HouseholdExpense } from "@/lib/household";
import { householdStore } from "@/services/household";
import { householdExpenseStore } from "@/services/householdExpenseStore";

/**
 * The user's household ("Mes dépenses" shared). Null on the server, at
 * hydration and until read from the device: callers then show nothing of it.
 * Refreshed by the account (lib/account/AccountProvider.tsx).
 */
export function useHousehold() {
  return useSyncExternalStore(householdStore.subscribe, householdStore.get, () => null);
}

/** In a household: "Mes dépenses" is in the menu even without the Admin plan (its household's view). */
export function useInHousehold() {
  return Boolean(useHousehold()?.household);
}

/** The expenses shared with the household, kept up to date. */
export function useHouseholdExpenses() {
  const [expenses, setExpenses] = useState<HouseholdExpense[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void householdExpenseStore.list().then((all) => {
        if (cancelled) return;
        setExpenses(all);
        setIsLoading(false);
      });
    load();
    const unsubscribe = householdExpenseStore.subscribe(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { expenses, isLoading };
}
