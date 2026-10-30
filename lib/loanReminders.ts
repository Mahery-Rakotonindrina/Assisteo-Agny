import { startOfDay } from "./format";
import { loanNextDue, loanRemaining, personKey, scheduleState, type Loan, type LoanDirection, type NextDue } from "./loans";

// "Me rappeler les échéances" in "Prêts": a local notification the day
// before the next payment expected (at 9 h), and for money lent, a second
// one on the day itself (at 17 h) to chase it up. The next payment is the
// schedule's next installment (loanNextDue), not `dueAt` (with a schedule,
// the last one). Pure, so it can be tested; scheduled by
// services/loanReminders.ts, redone when the app opens and at each change.

export const LOAN_NOTIFICATION_PREFIX = "loan:";
export const LOAN_EVE_HOUR = 9;
export const LOAN_DAY_HOUR = 17;
/** At most this many notifications are kept ahead, the soonest first. */
export const MAX_LOAN_REMINDERS = 40;

export type LoanReminderKind = "eve" | "day";

export type LoanReminder = {
  /** What it is kept under on the device: a change of day, amount or name schedules it again. */
  key: string;
  at: number;
  kind: LoanReminderKind;
  direction: LoanDirection;
  person: string;
  amountMga: number;
  /** Tapped: that person's page in "Prêts" (services/notificationTap.ts). */
  entryId: string;
};

/** "loan:lent:rakoto", "loan:borrowed:l'epicerie"; the day's one: "loan:nudge:rakoto". */
export const loanEntryId = (kind: LoanReminderKind, direction: LoanDirection, key: string) => `${LOAN_NOTIFICATION_PREFIX}${kind === "day" ? "nudge" : direction}:${key}`;

/** Where a loan's notification leads; null for another notification. */
export function loanTapTarget(entryId: string): { pathname: string; query: Record<string, string> } | null {
  if (!entryId.startsWith(LOAN_NOTIFICATION_PREFIX)) return null;
  const rest = entryId.slice(LOAN_NOTIFICATION_PREFIX.length);
  const split = rest.indexOf(":");
  const kind = split < 0 ? rest : rest.slice(0, split);
  const person = split < 0 ? "" : rest.slice(split + 1);
  if (!person) return { pathname: "/loans", query: {} };
  if (kind === "nudge") return { pathname: "/loans", query: { person, nudge: "1" } };
  return { pathname: "/loans", query: { ...(kind === "borrowed" && { dir: "borrowed" }), person } };
}

/**
 * The next payment still to come (today included): loanNextDue, but with a
 * schedule, an installment past and unpaid doesn't hide the next one.
 */
export function upcomingDue(loan: Loan, now: number): NextDue | undefined {
  if (!loan.schedule?.length) return loanNextDue(loan, now);
  if (loanRemaining(loan) <= 0) return undefined;
  const today = startOfDay(now);
  const next = scheduleState(loan, now).find((item) => item.leftMga > 0 && item.dueAt >= today);
  if (next) return { dueAt: next.dueAt, amountMga: next.leftMga, scheduled: true };
  const due = loanNextDue(loan, now);
  return due && due.dueAt >= today ? due : undefined;
}

/**
 * The notifications to ring, the soonest first: for each loan still to pay
 * back with a next payment, the day before at 9 h, and for money lent the
 * day itself at 17 h; only those still to come. None when switched off or
 * without the plan.
 */
export function loanReminders(loans: Loan[], now: number, enabled = true): LoanReminder[] {
  if (!enabled) return [];
  const reminders: LoanReminder[] = [];
  for (const loan of loans) {
    if (loan.deletedAt) continue;
    const next = upcomingDue(loan, now);
    if (!next) continue;
    const due = new Date(next.dueAt);
    const person = loan.person.trim();
    const key = personKey(loan.person);
    if (!key) continue;
    const base = { direction: loan.direction, person, amountMga: next.amountMga };
    const eve = new Date(due.getFullYear(), due.getMonth(), due.getDate() - 1, LOAN_EVE_HOUR).getTime();
    if (eve > now) reminders.push({ ...base, kind: "eve", at: eve, key: `${loan.id}:eve:${eve}:${next.amountMga}:${key}`, entryId: loanEntryId("eve", loan.direction, key) });
    if (loan.direction === "lent") {
      const day = new Date(due.getFullYear(), due.getMonth(), due.getDate(), LOAN_DAY_HOUR).getTime();
      if (day > now) reminders.push({ ...base, kind: "day", at: day, key: `${loan.id}:day:${day}:${next.amountMga}:${key}`, entryId: loanEntryId("day", loan.direction, key) });
    }
  }
  return reminders.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key)).slice(0, MAX_LOAN_REMINDERS);
}
