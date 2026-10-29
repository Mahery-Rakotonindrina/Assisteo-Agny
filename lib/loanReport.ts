import { loanInterest, loanNextDue, loanPaid, loanRemaining, loansByPerson, loanStatus, loanTotal, personKey, repaidAt, type Loan, type LoanDirection, type LoanStatus } from "./loans";

// "Prêts": what the exports (Excel, PDF) and "En chiffres" show. Pure, so it
// can be tested; the files are built in lib/loanExport.ts and
// services/loanPdf.ts.

const DAY = 24 * 60 * 60 * 1000;

export type LoanRow = {
  person: string;
  direction: LoanDirection;
  at: number;
  amountMga: number;
  interestMga: number;
  totalMga: number;
  paidMga: number;
  remainingMga: number;
  /** The next payment's day, else the agreed day; none once repaid without one. */
  dueAt: number | null;
  status: LoanStatus;
  note: string;
};

const live = (loans: Loan[]) => loans.filter((loan) => !loan.deletedAt);

/** One row per loan, by person then oldest first. */
export function loanRows(loans: Loan[], now: number): LoanRow[] {
  return live(loans)
    .sort((a, b) => personKey(a.person).localeCompare(personKey(b.person)) || a.at - b.at)
    .map((loan) => ({
      person: loan.person.trim(),
      direction: loan.direction,
      at: loan.at,
      amountMga: loan.amountMga,
      interestMga: loanInterest(loan),
      totalMga: loanTotal(loan),
      paidMga: loanPaid(loan),
      remainingMga: loanRemaining(loan),
      dueAt: loanNextDue(loan, now)?.dueAt ?? loan.dueAt ?? null,
      status: loanStatus(loan, now),
      note: loan.note ?? "",
    }));
}

export type PersonSummary = {
  name: string;
  direction: LoanDirection;
  loans: number;
  totalMga: number;
  paidMga: number;
  remainingMga: number;
  lateMga: number;
};

/** The recap per person and direction: owing first (the most left on top), then the settled ones. */
export function personSummaries(loans: Loan[], now: number): PersonSummary[] {
  const summaries: PersonSummary[] = [];
  for (const direction of ["lent", "borrowed"] as const) {
    for (const person of loansByPerson(live(loans), direction, now)) {
      summaries.push({
        name: person.name,
        direction,
        loans: person.loans.length,
        totalMga: person.loans.reduce((sum, loan) => sum + loanTotal(loan), 0),
        paidMga: person.loans.reduce((sum, loan) => sum + loanPaid(loan), 0),
        remainingMga: person.remaining,
        lateMga: person.lateAmount,
      });
    }
  }
  return summaries.sort((a, b) => (a.direction === b.direction ? b.remainingMga - a.remainingMga || a.name.localeCompare(b.name) : a.direction === "lent" ? -1 : 1));
}

export type LoanSide = {
  direction: LoanDirection;
  rows: LoanRow[];
  people: PersonSummary[];
  /** This way only: what is owed to the user is never added to what they owe. */
  totals: { amountMga: number; totalMga: number; paidMga: number; remainingMga: number; lateMga: number };
};

/** The exports, one part per way ("On me doit", then "Je dois"); a way without any loan is left out. */
export function loanSides(loans: Loan[], now: number): LoanSide[] {
  const rows = loanRows(loans, now);
  const people = personSummaries(loans, now);
  return (["lent", "borrowed"] as const)
    .map((direction) => {
      const mine = rows.filter((row) => row.direction === direction);
      const total = (key: "amountMga" | "totalMga" | "paidMga" | "remainingMga") => mine.reduce((sum, row) => sum + row[key], 0);
      const side = people.filter((person) => person.direction === direction);
      return {
        direction,
        rows: mine,
        people: side,
        totals: { amountMga: total("amountMga"), totalMga: total("totalMga"), paidMga: total("paidMga"), remainingMga: total("remainingMga"), lateMga: side.reduce((sum, person) => sum + person.lateMga, 0) },
      };
    })
    .filter((side) => side.rows.length > 0);
}

/** One person's loans, both ways (the export from their page). */
export function personLoans(loans: Loan[], name: string) {
  const key = personKey(name);
  return live(loans).filter((loan) => personKey(loan.person) === key);
}

export type LoanStats = {
  /** Lent (or borrowed) this year, interest left out. */
  totalMga: number;
  /** Paid back on those loans. */
  paidMga: number;
  /** Still to pay back on them. */
  remainingMga: number;
  count: number;
  /** Average days between the loan and its last repayment, over the repaid ones; null without any. */
  averageDays: number | null;
  /** The three people with the most late, the biggest first. */
  late: Array<{ name: string; lateMga: number }>;
};

/** "En chiffres": the loans of one direction made in the year of `now`. */
export function loanStats(loans: Loan[], direction: LoanDirection, now: number): LoanStats {
  const year = new Date(now).getFullYear();
  const mine = live(loans).filter((loan) => loan.direction === direction && new Date(loan.at).getFullYear() === year);
  const repaid = mine.filter((loan) => loanStatus(loan, now) === "repaid");
  const days = repaid.map((loan) => Math.max(0, (repaidAt(loan) - loan.at) / DAY));
  return {
    totalMga: mine.reduce((sum, loan) => sum + loan.amountMga, 0),
    paidMga: mine.reduce((sum, loan) => sum + loanPaid(loan), 0),
    remainingMga: mine.reduce((sum, loan) => sum + loanRemaining(loan), 0),
    count: mine.length,
    averageDays: days.length ? Math.round(days.reduce((sum, value) => sum + value, 0) / days.length) : null,
    late: loansByPerson(mine, direction, now)
      .filter((person) => person.lateAmount > 0)
      .sort((a, b) => b.lateAmount - a.lateAmount)
      .slice(0, 3)
      .map((person) => ({ name: person.name, lateMga: person.lateAmount })),
  };
}
