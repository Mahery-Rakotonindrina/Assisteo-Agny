import { storageRefusal } from "@/lib/storageQuota";

// Whether the account's photo storage refused an upload (the limit of
// migration 0020, or a file too big): shown in Settings → Account. The scan
// stays on the device, still waiting to be sent; nothing is lost. It clears
// itself when an upload goes through again (space freed, or the next sync).

let full = false;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (full === next) return;
  full = next;
  for (const listener of listeners) listener();
}

export const storageQuota = {
  isFull: () => full,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** An upload failed with `error`: true when it was the storage's refusal (the photo is skipped, not retried at once). */
  refused(error: unknown) {
    if (!storageRefusal(error)) return false;
    set(true);
    return true;
  },
  /** An upload went through. */
  accepted() {
    set(false);
  },
  /** Signed out: forget it. */
  reset() {
    set(false);
  },
};
