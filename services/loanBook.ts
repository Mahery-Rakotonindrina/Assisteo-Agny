import { isMineRow } from "@/lib/householdLoans";
import type { Loan, Repayment } from "@/lib/loans";
import { householdLoanStore } from "./householdLoanStore";
import { removeRepayment } from "./loanLink";
import { loanStore, type LoanFields } from "./loanStore";

// Where the loans of the "Prêts" screen are written: the user's own (the
// device, synced with "loans"), or the household's ("Foyer",
// services/householdLoanStore.ts). The cards and the sheets go through it, so
// both sides work the same; only the household's adds who may change what.

export type LoanBook = {
  scope: "personal" | "household";
  create(fields: LoanFields): Promise<Loan | null>;
  edit(id: string, fields: LoanFields): Promise<void>;
  /** Returns the amount kept, null if none. */
  addRepayment(id: string, repayment: { amountMga: number; at: number; note?: string; wallet?: string }): Promise<number | null>;
  markRepaid(id: string): Promise<number | null>;
  remove(id: string): Promise<void>;
  removeRepayment(loan: Loan, repayment: Repayment): Promise<void>;
  /** Corrected or removed by this user (the household's: its author only). */
  canEdit(loan: Loan): boolean;
  canRemoveRepayment(repayment: Repayment): boolean;
};

export const personalBook: LoanBook = {
  scope: "personal",
  create: (fields) => loanStore.create(fields),
  edit: (id, fields) => loanStore.edit(id, fields),
  addRepayment: (id, repayment) => loanStore.addRepayment(id, repayment),
  markRepaid: (id) => loanStore.markRepaid(id),
  remove: (id) => loanStore.remove(id),
  removeRepayment: (loan, repayment) => removeRepayment(loan.id, repayment),
  canEdit: () => true,
  canRemoveRepayment: () => true,
};

/** The household's loans, for the member `me` (named `myName` on what they note): anyone adds a repayment; each one changes what they wrote. */
export function householdBook(me: string | null, myName?: string): LoanBook {
  return {
    scope: "household",
    create: (fields) => householdLoanStore.create(fields, me),
    edit: (id, fields) => householdLoanStore.edit(id, fields, me),
    addRepayment: (id, repayment) => householdLoanStore.addRepayment(id, repayment, me, myName),
    markRepaid: (id) => householdLoanStore.markRepaid(id, me, myName),
    remove: (id) => householdLoanStore.remove(id, me),
    removeRepayment: (_loan, repayment) => householdLoanStore.removeRepayment(repayment.id, me),
    canEdit: (loan) => isMineRow(loan as { userId?: string }, me),
    canRemoveRepayment: (repayment) => isMineRow(repayment as { userId?: string }, me),
  };
}
