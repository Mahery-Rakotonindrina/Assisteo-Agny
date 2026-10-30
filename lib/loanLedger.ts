import { startOfDay } from "./format";
import { cappedRepayment, loanInterest, loanNextDue, loanRemaining, loanStatus, loanTotal, type Loan, type PersonLoans, type Repayment } from "./loans";

// "Compte avec Rakoto": every line with one person, like a bank statement,
// with what is left after each one ("Reste"), and the state shown on their
// card. Pure, so it can be tested; the screen is components/Loans/PersonDetail.tsx,
// the exports lib/loanExport.ts and services/loanPdf.ts.

const DAY = 24 * 60 * 60 * 1000;

/** "Pour quoi ?": the quick choices of the form (the text written is the loan's `note`). */
export const loanPurposes = ["school", "health", "transport", "shopping", "rent", "family", "other"] as const;
export type LoanPurpose = (typeof loanPurposes)[number];

export type LedgerKind = "loan" | "interest" | "repayment";

export type LedgerLine = {
  id: string;
  kind: LedgerKind;
  at: number;
  /** Always positive: a loan and its interest add to what is left, a repayment takes off. */
  amountMga: number;
  /** "Reste": what is left with this person once this line is counted. */
  balanceMga: number;
  /** The loan the line belongs to (the interest and the repayments: their loan). */
  loan: Loan;
  repayment?: Repayment;
};

const rank: Record<LedgerKind, number> = { loan: 0, interest: 1, repayment: 2 };

/**
 * One person's statement, in one direction, oldest first: each loan, its
 * interest as a line of its own (the day of the loan), and each repayment,
 * counted as the loan counts it (never more than what was left on it). The
 * last line's balance is what the person still owes. Removed loans are left out.
 */
export function personLedger(loans: Loan[]): LedgerLine[] {
  const lines: Omit<LedgerLine, "balanceMga">[] = [];
  for (const loan of loans) {
    if (loan.deletedAt) continue;
    lines.push({ id: loan.id, kind: "loan", at: loan.at, amountMga: loan.amountMga, loan });
    const interest = loanInterest(loan);
    if (interest > 0) lines.push({ id: `${loan.id}:interest`, kind: "interest", at: loan.at, amountMga: interest, loan });
    // Counted in the order they came, each one capped to what was left then.
    let left = loanTotal(loan);
    for (const repayment of [...(loan.repayments ?? [])].sort((a, b) => a.at - b.at)) {
      const counted = Number.isFinite(repayment.amountMga) && repayment.amountMga > 0 ? Math.min(Math.round(repayment.amountMga), left) : 0;
      left -= counted;
      if (counted > 0) lines.push({ id: `${loan.id}:${repayment.id}`, kind: "repayment", at: repayment.at, amountMga: counted, loan, repayment });
    }
  }
  lines.sort((a, b) => a.at - b.at || rank[a.kind] - rank[b.kind] || a.loan.at - b.loan.at || a.id.localeCompare(b.id));
  let balance = 0;
  return lines.map((line) => {
    balance += line.kind === "repayment" ? -line.amountMga : line.amountMga;
    return { ...line, balanceMga: balance };
  });
}

/** The statement as shown: newest first, by month (local time); `month` is the month's first day. */
export function ledgerMonths(lines: LedgerLine[]) {
  const months: Array<{ month: number; lines: LedgerLine[] }> = [];
  for (const line of [...lines].reverse()) {
    const day = new Date(line.at);
    const month = new Date(day.getFullYear(), day.getMonth(), 1).getTime();
    const last = months[months.length - 1];
    if (last?.month === month) last.lines.push(line);
    else months.push({ month, lines: [line] });
  }
  return months;
}

export type PersonBadge =
  /** Something is late, for `days` days (since the oldest late payment). */
  | { kind: "late"; days: number }
  /** The next payment's day. */
  | { kind: "due"; at: number }
  /** Owing, without any day agreed. */
  | { kind: "upToDate" }
  | { kind: "repaid" };

/** The pill on a person's card: "En retard de 12 j", "Échéance le 5 déc.", "À jour", "Remboursé". */
export function personBadge(person: Pick<PersonLoans, "loans">, now: number): PersonBadge {
  const today = startOfDay(now);
  let lateSince: number | undefined;
  let nextAt: number | undefined;
  let owing = false;
  for (const loan of person.loans) {
    if (loan.deletedAt || loanRemaining(loan) <= 0) continue;
    owing = true;
    const next = loanNextDue(loan, now);
    if (!next) continue;
    if (loanStatus(loan, now) === "late") lateSince = Math.min(lateSince ?? Infinity, next.dueAt);
    else nextAt = Math.min(nextAt ?? Infinity, next.dueAt);
  }
  if (lateSince !== undefined) return { kind: "late", days: Math.max(1, Math.round((today - startOfDay(lateSince)) / DAY)) };
  if (nextAt !== undefined) return { kind: "due", at: nextAt };
  return owing ? { kind: "upToDate" } : { kind: "repaid" };
}

/**
 * "Rakoto m'a rendu…" for a person rather than a loan: the amount paid back,
 * spread over their open loans in the order of their list (late first, then
 * the nearest due day…), each one up to what is left on it. What is more than
 * all that is left is not counted.
 */
export function spreadRepayment(loans: Loan[], amountMga: number): Array<{ loan: Loan; amountMga: number }> {
  let rest = Number.isFinite(amountMga) ? Math.round(amountMga) : 0;
  const parts: Array<{ loan: Loan; amountMga: number }> = [];
  for (const loan of loans) {
    if (rest <= 0) break;
    if (loan.deletedAt) continue;
    const part = cappedRepayment(loan, rest);
    if (part === null) continue;
    parts.push({ loan, amountMga: part });
    rest -= part;
  }
  return parts;
}
