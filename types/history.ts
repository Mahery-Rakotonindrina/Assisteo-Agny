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

  // ---- Sync bookkeeping (accounts) ----
  /** Last local change, used to settle edits made on two devices. */
  updatedAt?: number;
  /** Set when deleted while signed in: kept until the deletion is synced. */
  deletedAt?: number;
  /** False once the account has this exact version. Missing means "never synced". */
  dirty?: boolean;
  /** Paths of the photos in the account's storage, once uploaded. */
  remote?: { preview: string; thumbnail: string };
};
