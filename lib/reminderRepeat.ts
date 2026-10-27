// Recurring reminders and "remind me later": pure date arithmetic, shared by
// the app (reconciliation) and the server (the reminder push cron), so both
// land on the same next occurrence.

export type RepeatEvery = "monthly" | "yearly";

/**
 * A reminder that comes back every month or every year. `from` is the first
 * occurrence: later ones keep its day of the month and its time, so a 31st
 * falls on the last day of shorter months without drifting (31 → 30 → 31).
 * `offset` is the user's UTC offset in minutes when it was set, so the server
 * computes the same wall-clock time as the phone.
 */
export type ReminderRepeat = { every: RepeatEvery; from: number; offset: number };

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

export function makeRepeat(every: RepeatEvery, from: number): ReminderRepeat {
  return { every, from, offset: -new Date(from).getTimezoneOffset() };
}

/** A synced value read back (meta column, old data): null unless well formed. */
export function parseRepeat(value: unknown): ReminderRepeat | null {
  if (!value || typeof value !== "object") return null;
  const { every, from, offset } = value as Partial<ReminderRepeat>;
  if (every !== "monthly" && every !== "yearly") return null;
  if (typeof from !== "number" || !Number.isFinite(from)) return null;
  return { every, from, offset: typeof offset === "number" && Number.isFinite(offset) ? offset : 0 };
}

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/** The n-th occurrence (0 is `from` itself). */
export function occurrence(repeat: ReminderRepeat, index: number) {
  // Wall-clock time of the first occurrence, read in UTC once shifted.
  const local = new Date(repeat.from + repeat.offset * MINUTE);
  const months = local.getUTCMonth() + index * (repeat.every === "monthly" ? 1 : 12);
  const year = local.getUTCFullYear() + Math.floor(months / 12);
  const month = ((months % 12) + 12) % 12;
  const day = Math.min(local.getUTCDate(), daysInMonth(year, month));
  const wall = Date.UTC(year, month, day, local.getUTCHours(), local.getUTCMinutes(), local.getUTCSeconds(), local.getUTCMilliseconds());
  return wall - repeat.offset * MINUTE;
}

/** The first occurrence strictly after `after`. */
export function nextOccurrence(repeat: ReminderRepeat, after: number) {
  // The longest month or year, so the estimate never overshoots.
  const step = repeat.every === "monthly" ? 31 * DAY : 366 * DAY;
  let index = Math.max(0, Math.floor((after - repeat.from) / step) - 2);
  while (occurrence(repeat, index) <= after) index += 1;
  return occurrence(repeat, index);
}

/** The last occurrence strictly before `before`; null when none came yet. */
export function previousOccurrence(repeat: ReminderRepeat, before: number) {
  if (before <= repeat.from) return null;
  const step = repeat.every === "monthly" ? 31 * DAY : 366 * DAY;
  let index = Math.max(0, Math.floor((before - repeat.from) / step) - 2);
  while (occurrence(repeat, index + 1) < before) index += 1;
  return occurrence(repeat, index);
}

export type SnoozeChoice = "hour" | "tomorrow" | "week";
export const SNOOZE_CHOICES: SnoozeChoice[] = ["hour", "tomorrow", "week"];

/** "Remind me later": in an hour, tomorrow or in a week, at the same time of day. */
export function snoozeAt(choice: SnoozeChoice, now: number) {
  if (choice === "hour") return now + HOUR;
  const date = new Date(now);
  date.setDate(date.getDate() + (choice === "tomorrow" ? 1 : 7));
  return date.getTime();
}
