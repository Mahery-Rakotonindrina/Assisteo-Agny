import type { Analysis, ScanMode } from "@/lib/ai/schema";

export type HistoryEntry = {
  id: string;
  createdAt: number;
  mode: ScanMode;
  /** Small JPEG data URL for lists. */
  thumbnail: string;
  /** Medium JPEG data URL for the result screen. */
  preview: string;
  analysis: Analysis;
  meta: { model: string; demo: boolean; durationMs: number };
  /** Id of a scheduled local notification, if the user asked for a reminder. */
  reminderId?: number;
  reminderAt?: number;
};
