import { clear, createStore, del, get, set, values } from "idb-keyval";
import type { listKinds } from "@/lib/ai/schema";
import type { HistoryEntry } from "@/types/history";
import { createId } from "./historyStore";
import { parcelMiniature } from "./parcelStore";

// "Mes listes": shopping lists, to-do lists… read from a photo or written in
// the app, with items to tick. Local-first like the history; synced with the
// account (services/listSync.ts).

export type ListKind = (typeof listKinds)[number];

export type ListItem = { id: string; text: string; quantity?: string; done: boolean };

export type SavedList = {
  id: string;
  title: string;
  kind: ListKind;
  items: ListItem[];
  /** The scan it was read from, if any, and a small copy of its photo. */
  scanId?: string;
  thumbnail?: string;
  createdAt: number;
  updatedAt: number;
  /** Sync bookkeeping, like the parcels. */
  deletedAt?: number;
  dirty?: boolean;
};

let store: ReturnType<typeof createStore> | null = null;
const db = () => (store ??= createStore("assisteo-lists", "lists"));

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

// Signed in, deletions are kept until synced so they reach the other devices.
let keepTombstones = false;

async function write(list: SavedList) {
  await set(list.id, { ...list, updatedAt: Date.now(), dirty: true }, db());
  notify();
}

/** Applies a change to one list, if it still exists. */
async function change(id: string, update: (list: SavedList) => SavedList) {
  const current = await get<SavedList>(id, db());
  if (!current || current.deletedAt) return;
  await write(update(current));
}

const cleanText = (text: string) => text.trim().slice(0, 200);

export const listStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  async list(): Promise<SavedList[]> {
    return (await values<SavedList>(db())).filter((list) => !list.deletedAt);
  },

  /** The list made from this scan, if any. */
  async findForScan(scanId: string) {
    return (await listStore.list()).find((list) => list.scanId === scanId);
  },

  /** Keeps the list read on a scan (once per scan). */
  async addFromScan(entry: HistoryEntry) {
    const read = entry.analysis.list;
    if (!read) throw new Error("This scan is not a list.");
    const existing = await listStore.findForScan(entry.id);
    if (existing) return existing;
    const now = Date.now();
    const list: SavedList = {
      id: createId(),
      title: entry.analysis.title,
      kind: read.kind,
      items: read.items
        .filter((item) => item.text.trim())
        .map((item) => ({ id: createId(), text: cleanText(item.text), ...(item.quantity && { quantity: item.quantity }), done: item.done })),
      scanId: entry.id,
      thumbnail: await parcelMiniature(entry.thumbnail),
      createdAt: now,
      updatedAt: now,
    };
    await write(list);
    return list;
  },

  /** A new list written in the app. */
  async create(title: string, kind: ListKind = "shopping") {
    const now = Date.now();
    const list: SavedList = { id: createId(), title: cleanText(title) || "Liste", kind, items: [], createdAt: now, updatedAt: now };
    await write(list);
    return list;
  },

  rename: (id: string, title: string) => change(id, (list) => ({ ...list, title: cleanText(title) || list.title })),

  toggle: (id: string, itemId: string) =>
    change(id, (list) => ({ ...list, items: list.items.map((item) => (item.id === itemId ? { ...item, done: !item.done } : item)) })),

  addItem: (id: string, text: string, quantity?: string) =>
    change(id, (list) =>
      cleanText(text)
        ? { ...list, items: [...list.items, { id: createId(), text: cleanText(text), ...(quantity?.trim() && { quantity: quantity.trim() }), done: false }] }
        : list,
    ),

  editItem: (id: string, itemId: string, patch: { text: string; quantity?: string }) =>
    change(id, (list) => ({
      ...list,
      items: list.items.map((item) =>
        item.id === itemId ? { ...item, text: cleanText(patch.text) || item.text, quantity: patch.quantity?.trim() || undefined } : item,
      ),
    })),

  removeItem: (id: string, itemId: string) => change(id, (list) => ({ ...list, items: list.items.filter((item) => item.id !== itemId) })),

  /** Removes the ticked items. */
  clearDone: (id: string) => change(id, (list) => ({ ...list, items: list.items.filter((item) => !item.done) })),

  /** Unticks everything, to use the list again (weekly shopping…). */
  uncheckAll: (id: string) => change(id, (list) => ({ ...list, items: list.items.map((item) => ({ ...item, done: false })) })),

  async remove(id: string) {
    const current = await get<SavedList>(id, db());
    if (!current) return;
    if (keepTombstones) await write({ ...current, deletedAt: Date.now() });
    else {
      await del(id, db());
      notify();
    }
  },

  // ---- For the sync engine -----------------------------------------------------

  setKeepTombstones(value: boolean) {
    keepTombstones = value;
  },
  raw: () => values<SavedList>(db()),
  rawGet: (id: string) => get<SavedList>(id, db()),
  async rawPut(list: SavedList) {
    await set(list.id, list, db());
  },
  async rawDelete(id: string) {
    await del(id, db());
  },
  notify,
  /** Signing out or deleting the account. */
  async wipe() {
    await clear(db());
    notify();
  },
};

/** Ticked items over all items. */
export function listProgress(list: Pick<SavedList, "items">) {
  return { done: list.items.filter((item) => item.done).length, total: list.items.length };
}

/** Lists still to do first, the latest changed first; finished ones last. */
export function compareLists(a: SavedList, b: SavedList) {
  const finished = (list: SavedList) => {
    const { done, total } = listProgress(list);
    return total > 0 && done === total;
  };
  return Number(finished(a)) - Number(finished(b)) || b.updatedAt - a.updatedAt;
}
