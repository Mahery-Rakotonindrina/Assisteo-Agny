import { startOfDay } from "./format";
import { loanRemaining, loanTotal, personKey, type Loan, type LoanDirection, type Repayment } from "./loans";

// "Prêts" and "Mes poches": lending takes money out of a pocket, a repayment
// brings it back, borrowing the other way round. Neither an expense nor an
// income: only the pockets move ("Il te reste" doesn't). A "Vous avez reçu"
// from someone who owes money (or a payment to someone owed) can be counted
// as a repayment: the line of "Mes dépenses" is then kept out (an exclusion
// on its key) and the repayment points to it (`sourceKey`). Pure, so it can
// be tested; the pockets read loanMoves (lib/wallets.ts).

/** "lent": money lent; "borrowed": money borrowed; "repaid_in": paid back to me; "repaid_out": paid back by me. */
export type LoanMoveType = "lent" | "borrowed" | "repaid_in" | "repaid_out";

export type LoanMove = {
  key: string;
  type: LoanMoveType;
  at: number;
  /** Signed: negative, money out of the pocket. */
  amountMga: number;
  wallet: string;
  person: string;
  personKey: string;
  direction: LoanDirection;
};

/**
 * What the loans move in the pockets: each loan with a pocket (lent: out,
 * borrowed: in), and each repayment in its own pocket, else the loan's
 * (lent: in, borrowed: out). A loan or repayment without a pocket moves
 * nothing. The repayments never add up to more than the total to pay back.
 */
export function loanMoves(loans: Loan[]): LoanMove[] {
  const moves: LoanMove[] = [];
  for (const loan of loans) {
    if (loan.deletedAt) continue;
    const lent = loan.direction !== "borrowed";
    const base = { person: loan.person.trim(), personKey: personKey(loan.person), direction: loan.direction };
    if (loan.wallet && loan.amountMga > 0)
      moves.push({ ...base, key: `loan:${loan.id}`, type: lent ? "lent" : "borrowed", at: loan.at, amountMga: lent ? -loan.amountMga : loan.amountMga, wallet: loan.wallet });
    let left = loanTotal(loan);
    for (const repayment of [...(loan.repayments ?? [])].sort((a, b) => a.at - b.at)) {
      const amount = Math.min(left, Number.isFinite(repayment.amountMga) && repayment.amountMga > 0 ? repayment.amountMga : 0);
      left -= amount;
      const wallet = repayment.wallet ?? loan.wallet;
      if (!wallet || amount <= 0) continue;
      moves.push({ ...base, key: `loan:${loan.id}:${repayment.id}`, type: lent ? "repaid_in" : "repaid_out", at: repayment.at, amountMga: lent ? amount : -amount, wallet });
    }
  }
  return moves;
}

/** The words of a name, accents and case aside, the very short ones ("l'", "de") left out. */
function nameWords(name: string) {
  return personKey(name)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3);
}

/** "RAKOTO Jean" and "Rakoto", "Épicerie Chez Rabe" and "l'épicerie": a word in common. */
export function namesMatch(a: string | undefined, b: string | undefined) {
  if (!a || !b) return false;
  const words = new Set(nameWords(a));
  return nameWords(b).some((word) => words.has(word));
}

/** A line of "Mes dépenses" that may be a repayment: money received (`flow: "income"`) or paid. */
export type RepaymentSource = { key: string; at: number; amountMga: number; label?: string; flow?: "income"; scanId?: string };

/** The repayment already counted for that line, and its loan. */
export function linkedRepayment(loans: Loan[], sourceKey: string): { loan: Loan; repayment: Repayment } | undefined {
  for (const loan of loans) {
    if (loan.deletedAt) continue;
    const repayment = loan.repayments.find((item) => item.sourceKey === sourceKey);
    if (repayment) return { loan, repayment };
  }
  return undefined;
}

export type RepaymentProposal = {
  /** The oldest loan of that person still to pay back: the repayment goes on it. */
  loan: Loan;
  person: string;
  /** The line's amount, capped to what is left on the loan. */
  amountMga: number;
  /** A repayment of the same amount, within 3 days, typed in by hand already: "déjà enregistré ?". */
  same?: { loan: Loan; repayment: Repayment };
};

const SAME_DAYS = 3;
const DAY = 86_400_000;

/**
 * "C'est un remboursement de Rakoto ?": money received from someone who owes
 * money (lent, something left), or paid to someone owed (borrowed), the
 * names compared on their words. None when the line is a repayment already.
 */
export function repaymentProposal(loans: Loan[], source: RepaymentSource): RepaymentProposal | undefined {
  if (!source.label || !(source.amountMga > 0) || linkedRepayment(loans, source.key)) return undefined;
  const direction: LoanDirection = source.flow === "income" ? "lent" : "borrowed";
  const open = loans
    .filter((loan) => !loan.deletedAt && loan.direction === direction && loanRemaining(loan) > 0 && namesMatch(loan.person, source.label))
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const loan = open[0];
  if (!loan) return undefined;
  const key = personKey(loan.person);
  const amountMga = Math.min(Math.round(source.amountMga), loanRemaining(loan));
  let same: RepaymentProposal["same"];
  for (const other of loans) {
    if (other.deletedAt || other.direction !== direction || personKey(other.person) !== key) continue;
    const repayment = other.repayments.find(
      (item) => !item.sourceKey && (item.amountMga === Math.round(source.amountMga) || item.amountMga === amountMga) && Math.abs(startOfDay(item.at) - startOfDay(source.at)) <= SAME_DAYS * DAY + DAY / 24,
    );
    if (repayment) {
      same = { loan: other, repayment };
      break;
    }
  }
  return { loan, person: loan.person.trim(), amountMga, ...(same && { same }) };
}

/** The keys of the lines counted as repayments (kept out of "Mes dépenses", and never imported again). */
export function repaymentKeys(loans: Loan[]) {
  return new Set(loans.filter((loan) => !loan.deletedAt).flatMap((loan) => loan.repayments.flatMap((item) => (item.sourceKey ? [item.sourceKey] : []))));
}
