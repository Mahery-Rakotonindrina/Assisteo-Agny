import { surplusDraft, surplusId, type RepaymentProposal, type RepaymentSource } from "@/lib/loanLink";
import type { Loan, Repayment } from "@/lib/loans";
import { expenseStore } from "./expenseStore";
import { loanStore } from "./loanStore";

// "C'est un remboursement de Rakoto ?" (lib/loanLink.ts): the repayment is
// written on the loan, and the line of "Mes dépenses" it stands for is kept
// out of the incomes (or the expenses) by an exclusion on its key; what it
// has beyond what was left is counted apart (surplusId). Undone together.

/** The surplus of a line counted as a repayment, as its own income (or expense). */
export async function saveSurplus(source: RepaymentSource, keptMga: number, note: string, wallet: string | undefined) {
  const surplus = surplusDraft(source, keptMga, note, wallet);
  if (surplus?.kind === "income") await expenseStore.saveIncome(surplus.draft);
  else if (surplus) await expenseStore.saveExpense(surplus.draft);
}

/**
 * "Oui": the repayment, in the line's pocket; the line kept out, its surplus
 * counted apart (`surplusNote`: "Surplus de Rakoto"). The amount kept, null if none.
 */
export async function recordRepayment(proposal: RepaymentProposal, source: RepaymentSource, wallet: string | undefined, surplusNote: string) {
  const kept = await loanStore.addRepayment(proposal.loan.id, {
    amountMga: proposal.amountMga,
    at: source.at,
    wallet,
    sourceKey: source.key,
    scanId: source.scanId,
  });
  if (kept !== null) {
    await expenseStore.setExcluded(source.key, true);
    await saveSurplus(source, kept, surplusNote, wallet);
  }
  return kept;
}

/** "C'est le même": the repayment typed in already stands for the line, kept out. */
export async function linkSameRepayment(same: { loan: Loan; repayment: Repayment }, source: RepaymentSource) {
  await loanStore.linkRepayment(same.loan.id, same.repayment.id, { sourceKey: source.key, scanId: source.scanId });
  await expenseStore.setExcluded(source.key, true);
}

/** A repayment removed from the loan's card: the line it stood for counts again. */
export async function removeRepayment(loanId: string, repayment: Repayment) {
  await loanStore.removeRepayment(loanId, repayment.id);
  await countAgain(repayment);
}

/** The line counts whole again: its exclusion and its surplus go. */
async function countAgain(repayment: Repayment) {
  if (!repayment.sourceKey) return;
  await expenseStore.setExcluded(repayment.sourceKey, false);
  await expenseStore.remove(surplusId(repayment.sourceKey));
}

/** "Annuler": the repayment written from the line goes (one typed in by hand first stays), and the line counts again. */
export async function undoRepayment(loanId: string, repayment: Repayment) {
  if (repayment.linked) await loanStore.unlinkRepayment(loanId, repayment.id);
  else await loanStore.removeRepayment(loanId, repayment.id);
  await countAgain(repayment);
}
