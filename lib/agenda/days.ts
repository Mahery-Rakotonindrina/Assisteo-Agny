import type { AgendaItem } from "./types";

const DAY_MS = 86_400_000;

/** Midnight of the local day (the device's time zone, summer time included). */
export function localDay(at: number) {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** The local day `days` after the one of `at`: counted in calendar days, so a clock change never shifts it. */
export function addDays(at: number, days: number) {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days).getTime();
}

/** Whole calendar days from the day of `from` to the day of `at`. */
export const daysBetween = (from: number, at: number) => Math.round((localDay(at) - localDay(from)) / DAY_MS);

export type AgendaDay = { day: number; items: AgendaItem[] };

/** Items by local day, the days in order; in a day, the ones of a whole day first, then by time. */
export function groupByDay(items: AgendaItem[]): AgendaDay[] {
  const days = new Map<number, AgendaItem[]>();
  for (const item of items) {
    const day = localDay(item.at);
    days.set(day, [...(days.get(day) ?? []), item]);
  }
  return [...days.entries()]
    .sort(([a], [b]) => a - b)
    .map(([day, list]) => ({ day, items: list.sort((a, b) => Number(a.timed) - Number(b.timed) || a.at - b.at || a.key.localeCompare(b.key)) }));
}
