import { byKind, dayStart, type ExpenseRecord } from "@/lib/expenses";

// "Me rappeler chaque soir de noter mes dépenses": the next 7 evenings, one
// local notification each, an evening skipped when an expense was already
// noted that day. Pure, so it can be tested; scheduled by
// services/eveningReminder.ts.

export type EveningSetting = { on: boolean; hour: number; minute: number };

export const defaultEvening: EveningSetting = { on: false, hour: 20, minute: 0 };

/** How many evenings are scheduled ahead (redone when the app opens and at each expense). */
export const EVENING_DAYS = 7;

/** "20:00" → 20 h 00; anything else, the default time. */
export function parseEveningTime(value: string): Pick<EveningSetting, "hour" | "minute"> {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  const hour = match ? Number(match[1]) : NaN;
  const minute = match ? Number(match[2]) : NaN;
  return hour >= 0 && hour < 24 && minute >= 0 && minute < 60 ? { hour, minute } : { hour: defaultEvening.hour, minute: defaultEvening.minute };
}

export const eveningTime = ({ hour, minute }: Pick<EveningSetting, "hour" | "minute">) => `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

/** The days an expense was noted on: the day it is for, and the day it was typed in. */
function notedDays(records: ExpenseRecord[]) {
  const days = new Set<number>();
  for (const expense of byKind(records, "expense")) {
    days.add(dayStart(expense.at));
    days.add(dayStart(expense.createdAt));
  }
  return days;
}

/**
 * The evenings to ring, the soonest first: the next 7 to come (tonight
 * included while its time hasn't passed), less the ones of a day an expense
 * was noted. None when switched off or without the plan.
 */
export function eveningTimes(records: ExpenseRecord[], setting: EveningSetting, now: number, enabled = true): number[] {
  if (!enabled || !setting.on) return [];
  const noted = notedDays(records);
  const today = new Date(now);
  const times: number[] = [];
  for (let offset = 0, evenings = 0; evenings < EVENING_DAYS; offset += 1) {
    const at = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset, setting.hour, setting.minute).getTime();
    if (at <= now) continue;
    evenings += 1;
    if (!noted.has(dayStart(at))) times.push(at);
  }
  return times;
}

/** The key an evening is kept under on the device: its local day. */
export const eveningKey = (at: number) => {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
