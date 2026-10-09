import type { Locale } from "@/i18n.config";
import type { AnalyzeResponse, ScanMode } from "@/lib/ai/schema";
import type { ScannedCode } from "@/lib/codes";
import { encodeImage, type EncodedImage } from "@/lib/image";
import type { HistoryEntry } from "@/types/history";
import { ApiError } from "@/types/api";
import { analysisService } from "./analysisService";
import { createId, historyStore } from "./historyStore";
import { updateEarlierParcelScans } from "./parcelLinking";
import { planStore } from "./plan";
import { insuranceReminderAt, scheduleReminder } from "./reminders";

// One scan from the photos to the history: used by the scan screen, and by
// the offline queue once the network is back (services/scanQueue.ts).

/** A scan ready to send: the photo (and the other pages of a document), the mode, the codes read on it. */
export type ScanJob = {
  mode: ScanMode;
  locale: Locale;
  first: { upload: EncodedImage; preview: EncodedImage; thumbnail: EncodedImage };
  pages: Array<{ upload: EncodedImage; preview: EncodedImage }>;
  codes: ScannedCode[];
};

/** The texts of the automatic insurance reminder (they follow the language). */
export type InsuranceTexts = (entry: HistoryEntry) => Parameters<typeof scheduleReminder>[2];

/** Under the 4.5 MB a request may weigh on the server, with room to spare. */
const MAX_REQUEST_BASE64 = 3_800_000;

/** True when the request never reached the server: no network (the scan can wait in the queue). */
export function isOffline(error: unknown) {
  return error instanceof ApiError && error.code === "network";
}

/** Many heavy pages: lighter copies, so they fit in one request. */
async function fitPages(job: ScanJob) {
  const uploads = [job.first.upload, ...job.pages.map((page) => page.upload)];
  if (uploads.reduce((total, upload) => total + upload.base64.length, 0) <= MAX_REQUEST_BASE64) return uploads;
  return Promise.all(uploads.map((upload) => encodeImage(upload.dataUrl, 1100, 0.68)));
}

export async function sendScan(job: ScanJob, signal?: AbortSignal) {
  const [first, ...pages] = await fitPages(job);
  return analysisService.analyze(
    {
      image: first.base64,
      mediaType: first.mediaType,
      mode: job.mode,
      locale: job.locale,
      ...(pages.length > 0 && { pages: pages.map((page) => ({ image: page.base64, mediaType: page.mediaType })) }),
    },
    signal,
  );
}

/** Saves a finished scan in the history with what follows from it (reminder, parcel). Returns its id. */
export async function saveScan(job: ScanJob, { analysis, meta }: AnalyzeResponse, insuranceTexts: InsuranceTexts, createdAt = Date.now()) {
  const used = meta.quota ?? meta.trial;
  if (used) planStore.setUsage({ scans: used.used });

  const id = createId();
  await historyStore.save({
    id,
    createdAt,
    mode: job.mode,
    thumbnail: job.first.thumbnail.dataUrl,
    preview: job.first.preview.dataUrl,
    ...(job.pages.length > 0 && { pages: job.pages.map((page) => page.preview.dataUrl) }),
    analysis,
    meta: {
      ...meta,
      ...(job.pages.length > 0 && { pageCount: job.pages.length + 1 }),
      ...(job.codes.length > 0 && { codes: job.codes }),
    },
  });

  // Insurance: the 5-day notice is scheduled right away, without asking.
  const forcedAt = insuranceReminderAt(analysis);
  if (forcedAt !== null) {
    const saved = await historyStore.get(id);
    if (saved) await scheduleReminder(saved, forcedAt, insuranceTexts(saved));
  }

  // A parcel scanned before: the earlier scans take the new status.
  if (analysis.parcel) {
    const saved = await historyStore.get(id);
    if (saved) await updateEarlierParcelScans(saved).catch(() => undefined);
  }
  return id;
}
