import type { HistoryEntry } from "@/types/history";
import { historyStore } from "./historyStore";

// Photos are what fills the phone and the account's storage (~150 KB per
// preview, ~20 KB per thumbnail). The most recent scans keep their full
// preview; older ones fall back to the thumbnail, about 8x lighter. Nothing
// is deleted: the scan, its analysis and its chat stay as they are.

/** Scans that keep their full-size photo. */
export const FULL_PHOTOS_KEPT = 60;

/** Approximate bytes of a data URL (base64 is 4/3 of the binary). */
function dataUrlBytes(dataUrl: string) {
  return Math.round((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);
}

export function entryPhotoBytes(entry: Pick<HistoryEntry, "preview" | "thumbnail" | "pages">) {
  const pages = (entry.pages ?? []).reduce((total, page) => total + dataUrlBytes(page), 0);
  return (entry.preview === entry.thumbnail ? 0 : dataUrlBytes(entry.preview)) + dataUrlBytes(entry.thumbnail) + pages;
}

export function isCompacted(entry: Pick<HistoryEntry, "preview" | "thumbnail">) {
  return entry.preview === entry.thumbnail;
}

let running: Promise<number> | null = null;

/**
 * Replaces the preview of scans beyond the most recent ones by their
 * thumbnail. Synced entries are flagged so the account's copy shrinks too.
 * Returns how many scans were compacted.
 */
export function compactOldPhotos() {
  running ??= (async () => {
    const entries = (await historyStore.raw()).filter((entry) => !entry.deletedAt).sort((a, b) => b.createdAt - a.createdAt);
    let compacted = 0;
    for (const entry of entries.slice(FULL_PHOTOS_KEPT)) {
      if (isCompacted(entry) || !entry.thumbnail) continue;
      await historyStore.rawPut(
        {
          ...entry,
          preview: entry.thumbnail,
          // The other pages of a multi-page scan go too: the analysis keeps what they said.
          pages: undefined,
          // Already uploaded: the sync engine overwrites the remote preview.
          ...(entry.remote && { compactRemote: true, dirty: true }),
        },
        { silent: true },
      );
      compacted += 1;
    }
    if (compacted) historyStore.notify();
    return compacted;
  })().finally(() => {
    running = null;
  });
  return running;
}
