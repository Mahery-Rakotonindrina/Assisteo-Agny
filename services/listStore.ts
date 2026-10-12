import { clear, createStore, del, get, set, values } from "idb-keyval";
import type { listKinds } from "@/lib/ai/schema";
import type { HistoryEntry } from "@/types/history";
import { createId } from "./historyStore";
import { parcelMiniature } from "./parcelStore";

// "Mes listes": shopping lists, to-do lists… read from a photo or written in
// the app, with items to tick. Local-first like the history; synced with the
// account (services/listSync.ts).

export type ListKind = (typeof listKinds)[number];

export type ListItem = {
  id: string;
  text: string;
  quantity?: string;
  /** What the line costs, in ariary (entered by the user, or the last price paid). */
  priceMga?: number;
  done: boolean;
};

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

const textKey = (text: string) => text.trim().toLocaleLowerCase();
const sameText = (a: string, b: string) => textKey(a) === textKey(b);

/** The last price entered for each item, over every list (the latest changed list wins). */
async function priceMemory() {
  const prices = new Map<string, number>();
  const lists = (await values<SavedList>(db())).filter((list) => !list.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt);
  for (const list of lists) {
    for (const item of list.items) if (item.priceMga && !prices.has(textKey(item.text))) prices.set(textKey(item.text), item.priceMga);
  }
  return prices;
}

/** Items without a price take the last one entered for the same thing: an estimate. */
async function withKnownPrices(items: ListItem[]) {
  const prices = await priceMemory();
  return items.map((item) => (item.priceMga || !prices.has(textKey(item.text)) ? item : { ...item, priceMga: prices.get(textKey(item.text)) }));
}

/** A price typed by the user: a positive whole number of ariary, else none. */
const cleanPrice = (value: number | undefined) => (value && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined);

/** A recipe ingredient (`name`) or a list item (`text`). */
type NamedItem = { name?: string; text?: string; quantity?: string | null };

/** Ingredients (or any named items) as unticked list items. */
function recipeItems(items: NamedItem[]): ListItem[] {
  return items
    .map((item) => ({ text: cleanText(item.name ?? item.text ?? ""), quantity: item.quantity?.trim() }))
    .filter((item) => item.text)
    .map((item) => ({ id: createId(), text: item.text, ...(item.quantity && { quantity: item.quantity }), done: false }));
}

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
    const items: ListItem[] = read.items
      .filter((item) => item.text.trim())
      .map((item) => ({ id: createId(), text: cleanText(item.text), ...(item.quantity && { quantity: item.quantity }), done: item.done }));
    const list: SavedList = {
      id: createId(),
      title: entry.analysis.title,
      kind: read.kind,
      items: read.kind === "shopping" ? await withKnownPrices(items) : items,
      scanId: entry.id,
      thumbnail: await parcelMiniature(entry.thumbnail),
      createdAt: now,
      updatedAt: now,
    };
    await write(list);
    return list;
  },

  /** A shopping list made of a recipe's ingredients, linked to its scan. */
  async addFromRecipe(entry: HistoryEntry, title: string) {
    const recipe = entry.analysis.recipe;
    if (!recipe) throw new Error("This scan has no recipe.");
    const now = Date.now();
    const list: SavedList = {
      id: createId(),
      title: cleanText(title) || recipe.name,
      kind: "shopping",
      items: await withKnownPrices(recipeItems(recipe.ingredients)),
      scanId: entry.id,
      thumbnail: await parcelMiniature(entry.thumbnail),
      createdAt: now,
      updatedAt: now,
    };
    await write(list);
    return list;
  },

  /** Adds items to an existing list, skipping those it already has (not ticked). Returns how many were added. */
  async addItems(id: string, items: NamedItem[]) {
    let added = 0;
    const priced = await withKnownPrices(recipeItems(items));
    await change(id, (list) => {
      const fresh = priced.filter((item) => !list.items.some((other) => !other.done && sameText(other.text, item.text)));
      added = fresh.length;
      return { ...list, items: [...list.items, ...fresh] };
    });
    return added;
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

  /** Adds an item; without a price, a shopping list takes the last one entered for it. */
  async addItem(id: string, text: string, quantity?: string, priceMga?: number) {
    if (!cleanText(text)) return;
    const item: ListItem = { id: createId(), text: cleanText(text), ...(quantity?.trim() && { quantity: quantity.trim() }), done: false };
    const price = cleanPrice(priceMga);
    const [known] = price ? [{ ...item, priceMga: price }] : await withKnownPrices([item]);
    await change(id, (list) => ({ ...list, items: [...list.items, list.kind === "shopping" ? known : item] }));
  },

  editItem: (id: string, itemId: string, patch: { text: string; quantity?: string; priceMga?: number }) =>
    change(id, (list) => ({
      ...list,
      items: list.items.map((item) =>
        item.id === itemId
          ? { ...item, text: cleanText(patch.text) || item.text, quantity: patch.quantity?.trim() || undefined, priceMga: cleanPrice(patch.priceMga) }
          : item,
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

/** A shopping list's money: all priced items (estimate), the ticked ones (spent), and how many have no price. */
export function listTotals(list: Pick<SavedList, "items">) {
  const totals = { estimated: 0, spent: 0, unpriced: 0 };
  for (const item of list.items) {
    if (!item.priceMga) totals.unpriced += 1;
    else {
      totals.estimated += item.priceMga;
      if (item.done) totals.spent += item.priceMga;
    }
  }
  return totals;
}

/** Lists still to do first, the latest changed first; finished ones last. */
export function compareLists(a: SavedList, b: SavedList) {
  const finished = (list: SavedList) => {
    const { done, total } = listProgress(list);
    return total > 0 && done === total;
  };
  return Number(finished(a)) - Number(finished(b)) || b.updatedAt - a.updatedAt;
}
