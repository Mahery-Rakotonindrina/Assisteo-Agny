import type { Analysis, ChatMessage, ScanMode } from "@/lib/ai/schema";

export type ChatEntry = ChatMessage & { at: number };

/** Why an answer was wrong (see pages/api/feedback.ts). */
export type FeedbackReason = "wrong_subject" | "wrong_info" | "other";

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
  /** When this device's local notification fires (device-local, like reminderId). */
  reminderScheduledAt?: number;
  reminderAt?: number;
  /** Follow-up conversation about this scan. */
  chat?: ChatEntry[];
  /** The user's "was this right?" vote, kept on this device. */
  feedback?: { vote: "up" | "down"; reason?: FeedbackReason; at: number };

  // ---- Sync bookkeeping (accounts) ----
  /** Last local change, used to settle edits made on two devices. */
  updatedAt?: number;
  /** Set when deleted while signed in: kept until the deletion is synced. */
  deletedAt?: number;
  /** False once the account has this exact version. Missing means "never synced". */
  dirty?: boolean;
  /** Paths of the photos in the account's storage, once uploaded. */
  remote?: { preview: string; thumbnail: string };
  /** The preview was reduced to the thumbnail here; the account's copy still has to be. */
  compactRemote?: boolean;
};
