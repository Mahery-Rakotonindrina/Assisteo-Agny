import { loanStore, type Loan } from "./loanStore";
import { createRowSync } from "./rowSync";

// Syncs "Prêts" with the account (table "loans", see services/rowSync.ts).
// Until the table exists, each sync fails quietly (a console warning) and the
// loans stay on the device.

const loans = createRowSync<Loan>("loans", loanStore);

export const syncLoans = loans.sync;

/** Keeps "Prêts" synced while signed in. Returns the stop function. */
export const startLoanSync = loans.start;
