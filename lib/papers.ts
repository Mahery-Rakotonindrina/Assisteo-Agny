import type { Analysis, PaperKind } from "@/lib/ai/schema";
import { startOfDay } from "@/lib/format";

// "Mes papiers": ID cards, passports, insurance, warranties… scanned once and
// followed until they expire. A scan is a paper when the AI says so, or when
// the user files it; the user can also correct the expiry date.

/** A paper expiring within this many days is "soon". */
export const SOON_DAYS = 60;
const DAY = 86_400_000;

export type PaperStatus = "expired" | "soon" | "valid" | "undated";

type Paperish = { analysis: Pick<Analysis, "document">; paper?: PaperKind | "none"; expiresOn?: string; createdAt: number };

/** "YYYY-MM-DD" as local midnight; null when absent or invalid. */
export function parseDay(value: string | null | undefined) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

/** A day as "YYYY-MM-DD" (local time), for date fields. */
export function dayString(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** The kind a scan is filed as in "Mes papiers", or null: the user's choice wins over the AI's. */
export function paperKind(entry: Paperish): PaperKind | null {
  if (entry.paper === "none") return null;
  if (entry.paper) return entry.paper;
  const document = entry.analysis.document;
  if (!document) return null;
  return document.paper ?? (document.isInsurance ? "insurance" : null);
}

/** When the paper expires (local midnight), the user's date first; null without one. */
export function paperExpiry(entry: Paperish) {
  return parseDay(entry.expiresOn) ?? parseDay(entry.analysis.document?.expiresOn);
}

export function paperStatus(expiry: number | null, now: number): PaperStatus {
  if (expiry === null) return "undated";
  // Still valid on its expiry day.
  if (daysUntil(expiry, now) < 0) return "expired";
  return daysUntil(expiry, now) <= SOON_DAYS ? "soon" : "valid";
}

/** Whole days from today to the expiry (negative once expired). */
export function daysUntil(expiry: number, now: number) {
  return Math.round((expiry - startOfDay(now)) / DAY);
}

const statusOrder: Record<PaperStatus, number> = { expired: 0, soon: 1, valid: 2, undated: 3 };

/** The papers among the scans, the most urgent first: expired, soon, valid (by date), then undated (newest first). */
export function listPapers<T extends Paperish>(entries: T[], now: number) {
  return entries
    .map((entry) => {
      const kind = paperKind(entry);
      const expiry = paperExpiry(entry);
      return kind ? { entry, kind, expiry, status: paperStatus(expiry, now) } : null;
    })
    .filter((paper) => paper !== null)
    .sort(
      (a, b) =>
        statusOrder[a.status] - statusOrder[b.status] ||
        (a.expiry !== null && b.expiry !== null ? a.expiry - b.expiry : b.entry.createdAt - a.entry.createdAt),
    );
}
