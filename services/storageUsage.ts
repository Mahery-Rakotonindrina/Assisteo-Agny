import type { HistoryEntry } from "@/types/history";
import { historyStore } from "./historyStore";
import { listStore } from "./listStore";
import { parcelStore } from "./parcelStore";
import { scanQueue, type QueuedScan } from "./scanQueue";

// What the app keeps on this device, part by part, for the settings screen.
// Everything is stored as text (photos as base64 data URLs), so sizes are the
// text's length: close enough to tell where the space goes.

export type StorageUsage = {
  /** Photos of the scans in the history (full size, reduced, extra pages). */
  photosBytes: number;
  /** The rest of the history: analyses, chats, meals, papers… */
  analysesBytes: number;
  scans: number;
  parcelsBytes: number;
  listsBytes: number;
  /** Scans waiting for the network, with their photos. */
  queueBytes: number;
  queued: number;
  /** What the browser or the app's WebView reports for the whole app, when it can. */
  totalBytes: number | null;
};

/** Bytes of a value stored as JSON text (one byte per character: close enough). */
const textBytes = (value: unknown) => JSON.stringify(value)?.length ?? 0;

/** The photos of a scan: full size (unless reduced to the thumbnail), thumbnail, other pages. */
const photoBytes = (entry: Pick<HistoryEntry, "preview" | "thumbnail" | "pages">) =>
  (entry.preview === entry.thumbnail ? 0 : entry.preview.length) + entry.thumbnail.length + (entry.pages ?? []).reduce((total, page) => total + page.length, 0);

export function summarizeStorage(input: {
  history: HistoryEntry[];
  parcels: unknown[];
  lists: unknown[];
  queue: QueuedScan[];
  estimate: number | null;
}): StorageUsage {
  const history = input.history.filter((entry) => !entry.deletedAt);
  const photosBytes = history.reduce((total, entry) => total + photoBytes(entry), 0);
  const analysesBytes = history.reduce((total, entry) => total + textBytes({ ...entry, preview: "", thumbnail: "", pages: undefined }), 0);
  const queueBytes = input.queue.reduce((total, item) => total + textBytes(item), 0);
  const known = photosBytes + analysesBytes + textBytes(input.parcels) + textBytes(input.lists) + queueBytes;
  return {
    photosBytes,
    analysesBytes,
    scans: history.length,
    parcelsBytes: textBytes(input.parcels),
    listsBytes: textBytes(input.lists),
    queueBytes,
    queued: input.queue.length,
    // The browser counts more than our data (its own bookkeeping, the app's files on the web).
    totalBytes: input.estimate === null ? null : Math.max(input.estimate, known),
  };
}

/** Measures what the app keeps on this device right now. */
export async function measureStorage(): Promise<StorageUsage> {
  const [history, parcels, lists, queue, estimate] = await Promise.all([
    historyStore.raw(),
    parcelStore.raw(),
    listStore.raw(),
    scanQueue.list(),
    typeof navigator !== "undefined" && navigator.storage?.estimate
      ? navigator.storage
          .estimate()
          .then((result) => result.usage ?? null)
          .catch(() => null)
      : Promise.resolve(null),
  ]);
  return summarizeStorage({ history, parcels, lists, queue, estimate });
}
