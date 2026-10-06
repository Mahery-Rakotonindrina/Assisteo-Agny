import { clear, createStore, del, get, set, values } from "idb-keyval";
import type { HistoryEntry } from "@/types/history";

// IndexedDB works the same in the browser and in the Capacitor WebView, and
// unlike localStorage it comfortably holds image data URLs.

let store: ReturnType<typeof createStore> | null = null;
function db() {
  store ??= createStore("pocket-assistant", "history");
  return store;
}

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
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
    return entries.filter(isEntry).sort((a, b) => b.createdAt - a.createdAt);
  },

  async get(id: string) {
    const entry = await get<unknown>(id, db());
    return isEntry(entry) ? entry : undefined;
  },

  async save(entry: HistoryEntry) {
    await set(entry.id, entry, db());
    notify();
  },

  async update(id: string, patch: Partial<HistoryEntry>) {
    const current = await get<HistoryEntry>(id, db());
    if (!current) return;
    await set(id, { ...current, ...patch }, db());
    notify();
  },

  async remove(id: string) {
    await del(id, db());
    notify();
  },

  async clear() {
    await clear(db());
    notify();
  },
};

// Guards against records written by older versions or interrupted saves,
// which would otherwise crash every screen that lists the history.
function isEntry(value: unknown): value is HistoryEntry {
  const entry = value as Partial<HistoryEntry> | undefined;
  return Boolean(entry?.id && entry.analysis?.title && entry.analysis.category && entry.thumbnail);
}

export function createId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
