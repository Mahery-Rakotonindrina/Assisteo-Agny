import { startOfDay } from "@/lib/format";
import { parseDay } from "@/lib/papers";

// Ways to narrow the history down: favourites and folders the user made, and dates.

type Filed = { favorite?: boolean; folder?: string };

/** "all", "favorites", or a folder as "folder:<name>". */
export type Collection = "all" | "favorites" | `folder:${string}`;

/** A folder name as typed: trimmed, single spaces, at most 40 characters. */
export function cleanFolder(name: string) {
  return name.trim().replace(/\s+/g, " ").slice(0, 40);
}

/** The user's folders, by name, with how many scans each holds. */
export function folderList(entries: Filed[]) {
  const counts = new Map<string, number>();
  for (const entry of entries) if (entry.folder) counts.set(entry.folder, (counts.get(entry.folder) ?? 0) + 1);
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
}

export function inCollection(entry: Filed, collection: Collection) {
  if (collection === "all") return true;
  if (collection === "favorites") return Boolean(entry.favorite);
  return entry.folder === collection.slice("folder:".length);
}

// ---- Dates ---------------------------------------------------------------------------

export const datePresets = ["all", "today", "week", "month", "thisMonth", "custom"] as const;
export type DatePreset = (typeof datePresets)[number];

/** Local midnight, `days` days after the given day (safe across clock changes). */
function addDays(day: number, days: number) {
  const date = new Date(startOfDay(day));
  date.setDate(date.getDate() + days);
  return date.getTime();
}

/**
 * The [start, end) times a preset covers, today included; null for every date.
 * "custom" takes `from` and `to` as YYYY-MM-DD, both days included, either one optional.
 */
export function dateRange(preset: DatePreset, now: number, from?: string, to?: string): { start: number; end: number } | null {
  const tomorrow = addDays(now, 1);
  switch (preset) {
    case "all":
      return null;
    case "today":
      return { start: addDays(now, 0), end: tomorrow };
    case "week":
      return { start: addDays(now, -6), end: tomorrow };
    case "month":
      return { start: addDays(now, -29), end: tomorrow };
    case "thisMonth": {
      const date = new Date(now);
      return { start: new Date(date.getFullYear(), date.getMonth(), 1).getTime(), end: tomorrow };
    }
    case "custom": {
      const start = parseDay(from);
      const end = parseDay(to);
      return { start: start ?? -Infinity, end: end === null ? Infinity : addDays(end, 1) };
    }
  }
}

export function inRange(timestamp: number, range: { start: number; end: number } | null) {
  return !range || (timestamp >= range.start && timestamp < range.end);
}
