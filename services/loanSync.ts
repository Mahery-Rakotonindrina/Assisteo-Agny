import { syncLoanProofs } from "./loanProofSync";
import { loanStore, type Loan } from "./loanStore";
import { createRowSync } from "./rowSync";

// Syncs "Prêts" with the account (table "loans", see services/rowSync.ts).
// Until the table exists, each sync fails quietly (a console warning) and the
// loans stay on the device. The photo proofs follow (services/loanProofSync.ts).

const loans = createRowSync<Loan>("loans", loanStore);

const warn = (error: unknown) => console.warn("[loan proofs]", error instanceof Error ? error.message : error);

/** The loans, then their photos; a photo that fails never fails the loans. */
export async function syncLoans(uid: string) {
  await loans.sync(uid);
  await syncLoanProofs(uid).catch(warn);
}

/** Keeps "Prêts" synced while signed in. Returns the stop function. */
export function startLoanSync(uid: string) {
  const stop = loans.start(uid);
  let timer: ReturnType<typeof setTimeout> | undefined;
  // After the loans' own sync (1.5 s after a change): the photos, and the remote paths pushed next time.
  const run = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void syncLoanProofs(uid).catch(warn), 2500);
  };
  run();
  const unsubscribe = loanStore.subscribe(run);
  window.addEventListener("online", run);
  return () => {
    clearTimeout(timer);
    unsubscribe();
    window.removeEventListener("online", run);
    stop();
  };
}
