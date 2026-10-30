import { useEffect, useState, useSyncExternalStore } from "react";
import type { HouseholdLoan } from "@/lib/householdLoans";
import { householdLoanStore } from "@/services/householdLoanStore";
import { loanSharing, type SharingState } from "@/services/loanSharing";
import { loanStore, type Loan } from "@/services/loanStore";

const unknownSharing: SharingState = { kind: "unknown" };

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

/** The household's loans ("Foyer"), kept up to date. */
export function useHouseholdLoans() {
  const [loans, setLoans] = useState<HouseholdLoan[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void householdLoanStore.list().then((all) => {
        if (!cancelled) setLoans(all);
      });
    load();
    const unsubscribe = householdLoanStore.subscribe(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return loans;
}

/** Sharing a loan (the link to the borrower, the household's loans): "unknown" on the server and at hydration. */
export function useLoanSharing() {
  return useSyncExternalStore(loanSharing.subscribe, loanSharing.get, () => unknownSharing);
}
