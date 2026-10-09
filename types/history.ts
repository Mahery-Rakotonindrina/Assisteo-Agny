import type { Analysis, ChatMessage, PaperKind, ScanMode, TranslateLanguage } from "@/lib/ai/schema";
import type { ScannedCode } from "@/lib/codes";
import type { MealLog } from "@/lib/food";

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
  /**
   * `deep`: analysed again with the more capable model (Premium).
   * `pageCount`: a document scanned in several pages. `codes`: QR codes and barcodes read on the photo.
   */
  meta: { model: string; demo: boolean; durationMs: number; deep?: boolean; pageCount?: number; codes?: ScannedCode[] };
  /** A multi-page scan: the pages after the first (preview size), kept on this device. */
  pages?: string[];
  /** The full text of the document, read on demand, kept on this device. */
  transcript?: { text: string; at: number };
  /** That text translated, by language, kept on this device. */
  translations?: Partial<Record<TranslateLanguage, { text: string; at: number }>>;
  /** Id of a scheduled local notification, if the user asked for a reminder. */
  reminderId?: number;
  /** When this device's local notification fires (device-local, like reminderId). */
  reminderScheduledAt?: number;
  reminderAt?: number;
  /** Follow-up conversation about this scan. */
  chat?: ChatEntry[];
  /** "Mes papiers": the user's choice of kind ("none": not a paper), over the AI's. */
  paper?: PaperKind | "none";
  /** The expiry date corrected by the user, as YYYY-MM-DD. */
  expiresOn?: string;
  /** Food journal: each time this food was eaten. */
  meals?: MealLog[];
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
  /** Downloaded with the data saver on: only the thumbnail so far, the full photo comes later. */
  previewPending?: boolean;
};
