import { useEffect } from "react";
import { useHousehold } from "@/hooks/useHousehold";
import { useKeptLoans, useLoanSharing } from "@/hooks/useLoans";
import { usePlan } from "@/hooks/usePlan";
import { useAccount } from "@/lib/account/AccountProvider";
import { startHouseholdLoanSync } from "@/services/householdLoanStore";
import { loanSharing } from "@/services/loanSharing";
import { loanStore } from "@/services/loanStore";

/**
 * "Prêts", shared: asks the server once per account what is live (the links
 * sent to borrowers, and whether migration 0012 is there), writes a link's
 * copy again when that person's loans change, and keeps the household's loans
 * synced while a member. Signed in with "Prêts"; without it, only the links
 * are asked, when loans are kept on the device, so they can still be stopped.
 * Nothing before the migration (one quiet answer from the server, no error shown).
 */
export function LoanSharingKeeper() {
  const { session } = useAccount();
  const userId = session?.user.id ?? null;
  const { plan, has } = usePlan();
  const allowed = plan !== null && has("loans");
  // Without "Prêts": loans kept here, read only, may still have a live link to stop.
  const kept = useKeptLoans(plan !== null && !allowed && userId !== null);
  const householdId = useHousehold()?.household?.id ?? null;
  const sharing = useLoanSharing();
  const live = sharing.kind === "ready" && Object.keys(sharing.live).length > 0;
  const householdReady = (sharing.kind === "ready" || sharing.kind === "soon") && sharing.household;

  // Asked even without a session on this device: the server alone says who is signed in (a 401 is "signed out").
  useEffect(() => {
    if (plan === null) return;
    void loanSharing.ensure(allowed ? (userId ?? "device") : kept ? userId : null);
  }, [userId, allowed, plan, kept]);

  // A link's copy follows that person's loans (a moment after a change, from here or synced).
  useEffect(() => {
    if (!live || !allowed) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = loanStore.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(() => void loanStore.list().then((loans) => loanSharing.refresh(loans)), 2000);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [live, allowed]);

  useEffect(() => {
    if (!userId || !householdId || !allowed || !householdReady) return;
    return startHouseholdLoanSync(userId, householdId);
  }, [userId, householdId, allowed, householdReady]);

  return null;
}
