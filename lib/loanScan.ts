import type { LoanReading } from "./ai/schema";
import { MAX_INSTALLMENTS, type LoanDirection, type LoanInterest } from "./loans";

// "Prêts": a debt acknowledgment read by the AI (/api/loans/scan), turned into
// what prefills the loan form. Which side the user is on is guessed from the
// account's name; when it can't be told, the form asks. Pure, so it can be tested.

/** What the form is prefilled with. Days as "YYYY-MM-DD", like the form's date inputs. */
export type LoanScanDraft = {
  /** The user's side, when the account's name matches one name only; null: ask. */
  direction: LoanDirection | null;
  lender: string | null;
  borrower: string | null;
  amountMga: number | null;
  /** The amounts in figures and in words differ: both are shown, the figures are kept. */
  amountsDiffer: boolean;
  amountWords: string | null;
  amountWordsValue: number | null;
  day: string | null;
  dueDay: string | null;
  installments: Array<{ dueDay: string; amountMga: number }>;
  interest: LoanInterest | undefined;
  place: string | null;
};

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real day, never after `today` when `notAfter` is set. */
function cleanDay(value: string | null | undefined, today?: string) {
  const match = value ? DAY_RE.exec(value.trim()) : null;
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d || y < 1990) return null;
  const day = value!.trim();
  return today && day > today ? null : day;
}

const cleanName = (value: string | null | undefined) => value?.trim().replace(/\s+/g, " ").slice(0, 60) || null;
const cleanAmount = (value: number | null | undefined) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : null);

/** The words of a name, without accents or case ("Rakotó  Jean" → ["rakoto", "jean"]). */
export function nameWords(name: string | null | undefined) {
  return (name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 2);
}

/** Whether a name read on the document is the account's: a word in common (a first name, a family name). */
export function isSameName(read: string | null | undefined, account: string | null | undefined) {
  const words = new Set(nameWords(account));
  return words.size > 0 && nameWords(read).some((word) => words.has(word));
}

/** The user's side: "lent" when they are the lender only, "borrowed" when the borrower only; null otherwise. */
export function guessDirection(reading: Pick<LoanReading, "lender" | "borrower">, accountName: string | null | undefined): LoanDirection | null {
  const lender = isSameName(reading.lender, accountName);
  const borrower = isSameName(reading.borrower, accountName);
  if (lender === borrower) return null;
  return lender ? "lent" : "borrowed";
}

/** The other party, the person of the loan: the borrower when the user lent, the lender when they borrowed. */
export const otherParty = (draft: Pick<LoanScanDraft, "lender" | "borrower">, direction: LoanDirection) => (direction === "lent" ? draft.borrower : draft.lender) ?? "";

/** The reading as the form's values; `today` is "YYYY-MM-DD" (the day lent can't be later). */
export function loanScanDraft(reading: LoanReading, accountName: string | null | undefined, today: string): LoanScanDraft {
  const figures = cleanAmount(reading.amountFigures);
  const words = cleanAmount(reading.amountWordsValue);
  const installments = (reading.installments ?? [])
    .map((item) => ({ dueDay: cleanDay(item.dueDate), amountMga: cleanAmount(item.amount) }))
    .filter((item): item is { dueDay: string; amountMga: number } => item.dueDay !== null && item.amountMga !== null)
    .sort((a, b) => a.dueDay.localeCompare(b.dueDay))
    .slice(0, MAX_INSTALLMENTS);
  const interestValue = cleanAmount(reading.interest?.value);
  const lender = cleanName(reading.lender);
  const borrower = cleanName(reading.borrower);
  return {
    direction: guessDirection({ lender, borrower }, accountName),
    lender,
    borrower,
    amountMga: figures ?? words,
    amountsDiffer: figures !== null && words !== null && figures !== words,
    amountWords: cleanName(reading.amountWords),
    amountWordsValue: words,
    day: cleanDay(reading.date, today),
    dueDay: cleanDay(reading.dueDate),
    // A schedule is two installments or more.
    installments: installments.length >= 2 ? installments : [],
    interest: reading.interest && interestValue !== null ? { kind: reading.interest.kind === "percent" ? "percent" : "fixed", value: reading.interest.kind === "percent" ? reading.interest.value : interestValue } : undefined,
    place: cleanName(reading.place),
  };
}
