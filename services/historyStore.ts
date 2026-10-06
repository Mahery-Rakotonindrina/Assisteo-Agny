import { clear, createStore, del, get, set, values } from "idb-keyval";
import type { HistoryEntry } from "@/types/history";

// IndexedDB works the same in the browser and in the Capacitor WebView, and
// unlike localStorage it comfortably holds image data URLs.
//
// The store is local-first: every change lands here immediately and is marked
// dirty; the sync engine (services/sync.ts) pushes it to the account later.

let store: ReturnType<typeof createStore> | null = null;
function db() {
  store ??= createStore("pocket-assistant", "history");
  return store;
}

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

// While signed in, deletions are kept as tombstones until synced, so they
// reach the other devices. Signed out, they are removed right away.
let keepTombstones = false;

// Guards against records written by older versions or interrupted saves,
// which would otherwise crash every screen that lists the history.
function isEntry(value: unknown): value is HistoryEntry {
  const entry = value as Partial<HistoryEntry> | undefined;
  return Boolean(entry?.id && entry.analysis?.title && entry.analysis.category && entry.thumbnail);
}

function isVisible(entry: HistoryEntry) {
  return !entry.deletedAt;
}

export const historyStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  async list(): Promise<HistoryEntry[]> {
    const entries = await values<unknown>(db());
    return entries
      .filter(isEntry)
      .filter(isVisible)
      .sort((a, b) => b.createdAt - a.createdAt);
  },

  async get(id: string) {
    const entry = await get<unknown>(id, db());
    return isEntry(entry) && isVisible(entry) ? entry : undefined;
  },

  async save(entry: HistoryEntry) {
    await set(entry.id, { ...entry, updatedAt: Date.now(), dirty: true }, db());
    notify();
  },

  async update(id: string, patch: Partial<HistoryEntry>) {
    const current = await get<HistoryEntry>(id, db());
    if (!current) return;
    await set(id, { ...current, ...patch, updatedAt: Date.now(), dirty: true }, db());
    notify();
  },

  async remove(id: string) {
    const current = await get<HistoryEntry>(id, db());
    if (keepTombstones && current) {
      // Drop the photos now; only the deletion itself still needs syncing.
      await set(id, { ...current, deletedAt: Date.now(), updatedAt: Date.now(), dirty: true, preview: "" }, db());
    } else {
      await del(id, db());
    }
    notify();
  },

  async clear() {
    if (keepTombstones) {
      const all = await values<HistoryEntry>(db());
      await Promise.all(all.filter(isEntry).filter(isVisible).map((entry) => historyStore.remove(entry.id)));
    } else {
      await clear(db());
    }
    notify();
  },

  // ---- For the sync engine only ----

  setKeepTombstones(value: boolean) {
    keepTombstones = value;
  },

  /** Every record, including tombstones and not-yet-synced entries. */
  async raw(): Promise<HistoryEntry[]> {
    return (await values<unknown>(db())).filter(isEntry);
  },

  async rawGet(id: string) {
    const entry = await get<unknown>(id, db());
    return isEntry(entry) ? entry : undefined;
  },

  /** Writes exactly what the sync engine computed (no dirty/updatedAt bump). */
  async rawPut(entry: HistoryEntry, { silent = false } = {}) {
    await set(entry.id, entry, db());
    if (!silent) notify();
  },

  async rawDelete(id: string, { silent = false } = {}) {
    await del(id, db());
    if (!silent) notify();
  },

  /** Signing out: this device forgets everything (the account keeps it). */
  async wipe() {
    await clear(db());
    notify();
  },

  notify,
};

export function createId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
