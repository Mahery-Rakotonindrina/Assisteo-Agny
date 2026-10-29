import type { Locale } from "@/i18n.config";
import { formatAriary, startOfDay } from "./format";

// "Prêts": money lent to someone ("On me doit") or borrowed ("Je dois"), and
// what has been paid back. Kept apart from "Mes dépenses" on purpose: lending
// is neither an expense nor an income. What is left, and whether a loan is
// late or repaid, is always worked out here, never stored. Pure, so it can be
// tested; the device store is services/loanStore.ts.

export const loanDirections = ["lent", "borrowed"] as const;
export type LoanDirection = (typeof loanDirections)[number];

export type Repayment = { id: string; at: number; amountMga: number; note?: string };

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
  note?: string;
  repayments: Repayment[];
  updatedAt: number;
  deletedAt?: number;
  dirty?: boolean;
};

export type LoanStatus = "open" | "late" | "repaid";

const DAY = 24 * 60 * 60 * 1000;

/** What was paid back so far (never more than the loan). */
export function loanPaid(loan: Pick<Loan, "amountMga" | "repayments">) {
  const paid = (loan.repayments ?? []).reduce((sum, repayment) => sum + (Number.isFinite(repayment.amountMga) && repayment.amountMga > 0 ? repayment.amountMga : 0), 0);
  return Math.min(paid, loan.amountMga);
}

/** What is left to pay back. */
export function loanRemaining(loan: Pick<Loan, "amountMga" | "repayments">) {
  return Math.max(0, loan.amountMga - loanPaid(loan));
}

/** Repaid once nothing is left; late from the day after the due day. */
export function loanStatus(loan: Pick<Loan, "amountMga" | "repayments" | "dueAt">, now: number): LoanStatus {
  if (loanRemaining(loan) <= 0) return "repaid";
  return loan.dueAt !== undefined && loan.dueAt < startOfDay(now) ? "late" : "open";
}

/**
 * A repayment typed by the user, capped to what is left (an overpayment is
 * not a debt the other way). `editing` is left out of the count when a
 * repayment is corrected. Null when nothing can be paid back.
 */
export function cappedRepayment(loan: Pick<Loan, "amountMga" | "repayments">, amountMga: number, editing?: string) {
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
  /** The nearest due day of an open loan. */
  nextDue?: number;
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
  const dueA = a.dueAt ?? Infinity;
  const dueB = b.dueAt ?? Infinity;
  if (dueA !== dueB) return dueA - dueB;
  const leftA = loanRemaining(a);
  const leftB = loanRemaining(b);
  if (leftA !== leftB) return leftB - leftA;
  return b.at - a.at;
}

/** Late people first, then by the nearest due day, then by the biggest amount left. */
function comparePeople(a: PersonLoans, b: PersonLoans) {
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
        person.lateAmount += left;
      }
      if (loan.dueAt !== undefined && (person.nextDue === undefined || loan.dueAt < person.nextDue)) person.nextDue = loan.dueAt;
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
