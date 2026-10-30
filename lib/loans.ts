import type { Locale } from "@/i18n.config";
import { formatAriary, startOfDay } from "./format";

// "Prêts": money lent to someone ("On me doit") or borrowed ("Je dois"), and
// what has been paid back. Kept apart from "Mes dépenses" on purpose: lending
// is neither an expense nor an income. What is left, and whether a loan is
// late or repaid, is always worked out here, never stored. Pure, so it can be
// tested; the device store is services/loanStore.ts.

export const loanDirections = ["lent", "borrowed"] as const;
export type LoanDirection = (typeof loanDirections)[number];

/**
 * A repayment. `wallet`: the pocket it came into (or went out of), with
 * "Mes poches" (lib/loanLink.ts). `sourceKey`: the line of "Mes dépenses" it
 * stands for (a scanned "Vous avez reçu", a statement's line), kept out of
 * the incomes or the expenses; `scanId`: that scan. `linked`: typed in by
 * hand first, then said to be that line ("C'est le même").
 */
export type Repayment = { id: string; at: number; amountMga: number; note?: string; wallet?: string; sourceKey?: string; scanId?: string; linked?: true };

/** One planned payment of a loan paid back in several times (local midnight). */
export type Installment = { id: string; dueAt: number; amountMga: number };

/** Interest or fees agreed on top of the loan: a fixed amount, or a share of it. */
export type LoanInterest = { kind: "fixed" | "percent"; value: number };

/**
 * A proof attached to a loan: a photo taken for it ("photo", its image on the
 * device and in the account's storage at `remote`), or a scan of the history
 * ("scan", read from there, never copied).
 */
export type LoanProof = { id: string; kind: "photo" | "scan"; scanId?: string; remote?: string; addedAt: number };

export const scheduleFrequencies = ["week", "month"] as const;
export type ScheduleFrequency = (typeof scheduleFrequencies)[number];

export type Loan = {
  id: string;
  direction: LoanDirection;
  person: string;
  phone?: string;
  amountMga: number;
  /** When the money was lent or borrowed. */
  at: number;
  /** The day it should be paid back by (local midnight), if agreed. */
  dueAt?: number;
  /** Paid back in several times, oldest first; `dueAt` is then the last one's day. */
  schedule?: Installment[];
  interest?: LoanInterest;
  note?: string;
  /** Proofs attached (photos, scans of the history); the images live apart (lib/loanProof.ts). */
  proofs?: LoanProof[];
  /** The pocket the money left (lent) or came into (borrowed), with "Mes poches"; none: the pockets don't move. */
  wallet?: string;
  repayments: Repayment[];
  updatedAt: number;
  deletedAt?: number;
  dirty?: boolean;
};

export type LoanStatus = "open" | "late" | "repaid";

const DAY = 24 * 60 * 60 * 1000;

/** What a loan's amounts are worked out from. */
type LoanMoney = Pick<Loan, "amountMga" | "repayments" | "interest">;
type LoanDue = LoanMoney & Pick<Loan, "dueAt" | "schedule">;

export const MAX_INSTALLMENTS = 36;

/** The interest or fees agreed, in ariary (0 without). */
export function loanInterest(loan: Pick<Loan, "amountMga" | "interest">) {
  const interest = loan.interest;
  if (!interest || !Number.isFinite(interest.value) || interest.value <= 0) return 0;
  return Math.round(interest.kind === "percent" ? (loan.amountMga * interest.value) / 100 : interest.value);
}

/** "À rendre": the loan and its interest. What is left, the schedule and "Marquer comme remboursé" follow it. */
export function loanTotal(loan: Pick<Loan, "amountMga" | "interest">) {
  return loan.amountMga + loanInterest(loan);
}

/** What was paid back so far (never more than the total to pay back). */
export function loanPaid(loan: LoanMoney) {
  const paid = (loan.repayments ?? []).reduce((sum, repayment) => sum + (Number.isFinite(repayment.amountMga) && repayment.amountMga > 0 ? repayment.amountMga : 0), 0);
  return Math.min(paid, loanTotal(loan));
}

/** What is left to pay back. */
export function loanRemaining(loan: LoanMoney) {
  return Math.max(0, loanTotal(loan) - loanPaid(loan));
}

export type InstallmentStatus = "paid" | "partial" | "upcoming" | "late";
export type InstallmentState = Installment & { paidMga: number; leftMga: number; status: InstallmentStatus };

/**
 * The schedule with what is paid on each: repayments pay the installments in
 * order. Late when its day is past and it is not fully paid.
 */
export function scheduleState(loan: LoanDue, now: number): InstallmentState[] {
  let paid = loanPaid(loan);
  const today = startOfDay(now);
  return (loan.schedule ?? []).map((item) => {
    const paidMga = Math.min(paid, item.amountMga);
    paid -= paidMga;
    const leftMga = item.amountMga - paidMga;
    const status: InstallmentStatus = leftMga <= 0 ? "paid" : item.dueAt < today ? "late" : paidMga > 0 ? "partial" : "upcoming";
    return { ...item, paidMga, leftMga, status };
  });
}

export type NextDue = { dueAt: number; amountMga: number; scheduled: boolean };

/** The next payment expected: the first installment not fully paid, or the single due day. */
export function loanNextDue(loan: LoanDue, now: number): NextDue | undefined {
  if (loanRemaining(loan) <= 0) return undefined;
  if (loan.schedule?.length) {
    const next = scheduleState(loan, now).find((item) => item.leftMga > 0);
    if (next) return { dueAt: next.dueAt, amountMga: next.leftMga, scheduled: true };
    // Parts that add up to less than the total: the rest is due with the last one.
    const last = loan.schedule[loan.schedule.length - 1];
    return { dueAt: last.dueAt, amountMga: loanRemaining(loan), scheduled: true };
  }
  return loan.dueAt !== undefined ? { dueAt: loan.dueAt, amountMga: loanRemaining(loan), scheduled: false } : undefined;
}

/**
 * What is late: with a schedule, only the unpaid part of the installments
 * whose day is past (and, once they are all past, what the parts left out);
 * without one, all that is left once the due day is past.
 */
export function loanLateAmount(loan: LoanDue, now: number) {
  const left = loanRemaining(loan);
  if (left <= 0) return 0;
  const today = startOfDay(now);
  if (loan.schedule?.length) {
    const states = scheduleState(loan, now);
    const late = states.filter((item) => item.status === "late").reduce((sum, item) => sum + item.leftMga, 0);
    // Parts adding up to less than the total: the rest is due with the last one.
    const unplanned = Math.max(0, left - states.reduce((sum, item) => sum + item.leftMga, 0));
    return late + (unplanned > 0 && states[states.length - 1].dueAt < today ? unplanned : 0);
  }
  return loan.dueAt !== undefined && loan.dueAt < today ? left : 0;
}

/** Repaid once nothing is left; late from the day after the due day (the next installment's, with a schedule). */
export function loanStatus(loan: LoanDue, now: number): LoanStatus {
  if (loanRemaining(loan) <= 0) return "repaid";
  const next = loanNextDue(loan, now);
  return next !== undefined && next.dueAt < startOfDay(now) ? "late" : "open";
}

/** The day of the `index`-th payment (0 = the first), every week or every month (the month's last day when shorter). */
export function installmentDay(first: number, frequency: ScheduleFrequency, index: number) {
  const day = new Date(startOfDay(first));
  if (frequency === "week") return new Date(day.getFullYear(), day.getMonth(), day.getDate() + 7 * index).getTime();
  const target = new Date(day.getFullYear(), day.getMonth() + index, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(day.getDate(), last)).getTime();
}

/** "Rembourser en plusieurs fois": equal parts in whole ariary, the rounding on the last one. */
export function splitSchedule(totalMga: number, count: number, frequency: ScheduleFrequency, first: number): Installment[] {
  const times = Math.max(1, Math.min(MAX_INSTALLMENTS, Math.round(count) || 1));
  const total = Math.max(0, Math.round(totalMga));
  const part = Math.floor(total / times);
  return Array.from({ length: times }, (_, index) => ({
    id: `e${index + 1}`,
    dueAt: installmentDay(first, frequency, index),
    amountMga: index === times - 1 ? total - part * (times - 1) : part,
  }));
}

/** The frequency a schedule was made with (for the form, when a loan is corrected). */
export function scheduleFrequency(schedule: Installment[]): ScheduleFrequency {
  if (schedule.length < 2) return "month";
  return schedule[1].dueAt - schedule[0].dueAt > 10 * DAY ? "month" : "week";
}

/**
 * A repayment typed by the user, capped to what is left (an overpayment is
 * not a debt the other way). `editing` is left out of the count when a
 * repayment is corrected. Null when nothing can be paid back.
 */
export function cappedRepayment(loan: LoanMoney, amountMga: number, editing?: string) {
  if (!Number.isFinite(amountMga) || amountMga <= 0) return null;
  const left = loanRemaining({ ...loan, repayments: loan.repayments.filter((repayment) => repayment.id !== editing) });
  const amount = Math.min(Math.round(amountMga), left);
  return amount > 0 ? amount : null;
}

/** When the last repayment came in, for a repaid loan. */
export function repaidAt(loan: Pick<Loan, "repayments" | "at">) {
  return loan.repayments.reduce((latest, repayment) => Math.max(latest, repayment.at), loan.at);
}

/** "Rakoto", " rakoto ", "Rakotó": one and the same person. */
export function personKey(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export type PersonLoans = {
  key: string;
  /** The name as last written. */
  name: string;
  /** The last phone number written for them. */
  phone?: string;
  /** What is left on their loans still open. */
  remaining: number;
  /** What is left on their late loans. */
  lateAmount: number;
  /** Loans still open (late ones included). */
  open: number;
  late: boolean;
  /** The nearest due day of an open loan (the next installment's, with a schedule). */
  nextDue?: number;
  /** The payment expected on `nextDue`. */
  next?: NextDue;
  /** Every loan of this person in this direction, in the order of `compareLoans`. */
  loans: Loan[];
};

/** An amount that never breaks before "Ar" on a narrow screen. */
export function loanMoney(value: number, locale: Locale) {
  return formatAriary(value, locale).replace(/ Ar$/, "\u00a0Ar");
}

/**
 * A person's loans, as their list is sorted: open ones first (late, then by
 * due day, then by the biggest amount left, then newest), the repaid ones
 * last (last repaid first).
 */
export function compareLoans(a: Loan, b: Loan, now: number) {
  const statusA = loanStatus(a, now);
  const statusB = loanStatus(b, now);
  if ((statusA === "repaid") !== (statusB === "repaid")) return statusA === "repaid" ? 1 : -1;
  if (statusA === "repaid") return repaidAt(b) - repaidAt(a);
  if ((statusA === "late") !== (statusB === "late")) return statusA === "late" ? -1 : 1;
  const dueA = loanNextDue(a, now)?.dueAt ?? Infinity;
  const dueB = loanNextDue(b, now)?.dueAt ?? Infinity;
  if (dueA !== dueB) return dueA - dueB;
  const leftA = loanRemaining(a);
  const leftB = loanRemaining(b);
  if (leftA !== leftB) return leftB - leftA;
  return b.at - a.at;
}

/** Late people first, then by the nearest due day, then by the biggest amount left. */
export function comparePeople(a: PersonLoans, b: PersonLoans) {
  if (a.late !== b.late) return a.late ? -1 : 1;
  const dueA = a.nextDue ?? Infinity;
  const dueB = b.nextDue ?? Infinity;
  if (dueA !== dueB) return dueA - dueB;
  if (a.remaining !== b.remaining) return b.remaining - a.remaining;
  return a.name.localeCompare(b.name);
}

/** The loans of one direction, gathered by person (every person, repaid or not), sorted. */
export function loansByPerson(loans: Loan[], direction: LoanDirection, now: number): PersonLoans[] {
  const people = new Map<string, PersonLoans>();
  const newest = [...loans].filter((loan) => !loan.deletedAt && loan.direction === direction).sort((a, b) => b.at - a.at || b.updatedAt - a.updatedAt);
  for (const loan of newest) {
    const key = personKey(loan.person);
    if (!key) continue;
    const person = people.get(key) ?? { key, name: loan.person.trim(), phone: undefined, remaining: 0, lateAmount: 0, open: 0, late: false, loans: [] };
    person.phone ??= loan.phone;
    person.loans.push(loan);
    const status = loanStatus(loan, now);
    if (status !== "repaid") {
      const left = loanRemaining(loan);
      person.remaining += left;
      person.open += 1;
      if (status === "late") {
        person.late = true;
        person.lateAmount += loanLateAmount(loan, now);
      }
      const next = loanNextDue(loan, now);
      if (next && (person.nextDue === undefined || next.dueAt < person.nextDue)) {
        person.nextDue = next.dueAt;
        person.next = next;
      }
    }
    people.set(key, person);
  }
  for (const person of people.values()) person.loans.sort((a, b) => compareLoans(a, b, now));
  return [...people.values()].sort(comparePeople);
}

/** The top card: what is owed in all, by how many people, and how much of it is late. */
export function loanTotals(people: PersonLoans[]) {
  const owing = people.filter((person) => person.open > 0);
  return {
    total: owing.reduce((sum, person) => sum + person.remaining, 0),
    people: owing.length,
    late: owing.reduce((sum, person) => sum + person.lateAmount, 0),
  };
}

/** The repaid loans of one direction, last repaid first (the folded list at the bottom). */
export function repaidLoans(loans: Loan[], direction: LoanDirection, now: number) {
  return loans
    .filter((loan) => !loan.deletedAt && loan.direction === direction && loanStatus(loan, now) === "repaid")
    .sort((a, b) => repaidAt(b) - repaidAt(a));
}

/** People whose name holds the search, accents and case aside. */
export function searchPeople(people: PersonLoans[], query: string) {
  const wanted = personKey(query);
  return wanted ? people.filter((person) => person.key.includes(wanted)) : people;
}

/** Names already written, last used first, for the person field. */
export function knownPeople(loans: Loan[]) {
  const seen = new Map<string, string>();
  for (const loan of [...loans].filter((item) => !item.deletedAt).sort((a, b) => b.at - a.at)) {
    const key = personKey(loan.person);
    if (key && !seen.has(key)) seen.set(key, loan.person.trim());
  }
  return [...seen.values()];
}

/** The last phone number written for a person, to prefill a new loan. */
export function knownPhone(loans: Loan[], person: string) {
  const key = personKey(person);
  return [...loans].filter((loan) => !loan.deletedAt && loan.phone && personKey(loan.person) === key).sort((a, b) => b.at - a.at)[0]?.phone;
}

/** The due day shortcuts: in a week, in a month (same day next month, or its last day). */
export function dueIn(span: "week" | "month", now: number) {
  const day = new Date(startOfDay(now));
  if (span === "week") return startOfDay(day.getTime() + 7 * DAY + DAY / 2);
  const target = new Date(day.getFullYear(), day.getMonth() + 1, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(day.getDate(), last)).getTime();
}

/** A date input's value ("2026-10-29") as local midnight; undefined when empty or wrong. */
export function dayFromInput(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const at = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
  return Number.isFinite(at) ? at : undefined;
}

/**
 * A phone number as WhatsApp wants it: digits only, with the country code.
 * A Malagasy number "034 12 345 67" (or "34 12 345 67") becomes 261341234567;
 * one written with "+" or "00" keeps its own code. Null when it can't be one.
 */
export function whatsappNumber(phone: string | undefined) {
  if (!phone) return null;
  const trimmed = phone.trim();
  let digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? digits : null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (/^0[23]\d{8}$/.test(digits)) digits = `261${digits.slice(1)}`;
  else if (/^3\d{8}$/.test(digits)) digits = `261${digits}`;
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/** "Relancer sur WhatsApp": the chat with the message already written; null without a usable number. */
export function whatsappLink(phone: string | undefined, message: string) {
  const number = whatsappNumber(phone);
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(message)}` : null;
}
