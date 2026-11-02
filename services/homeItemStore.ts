import { clear, createStore, del, get, set, values } from "idb-keyval";
import { encodeImage } from "@/lib/image";
import { fillFromPaper, homeCategories, homeRooms, itemFieldsFrom, withPaper, type HomeItem } from "@/lib/inventory";
import type { HistoryEntry } from "@/types/history";
import { createId } from "./historyStore";

// "Ma maison": the things of the home with their purchase, warranty and
// papers. Local-first like "Mon garage"; synced with the account
// (services/homeItemSync.ts). The logic lives in lib/inventory.ts.

export type { HomeItem } from "@/lib/inventory";

/** What the item form edits. */
export type HomeItemFields = Partial<Pick<HomeItem, "name" | "thumbnail" | "room" | "category" | "boughtOn" | "priceMga" | "store" | "warrantyUntil" | "serial" | "note">>;

/** The photo's longest edge: big enough for the exports' thumbnails, small enough to sync. */
const PHOTO_EDGE = 320;

let store: ReturnType<typeof createStore> | null = null;
const db = () => (store ??= createStore("assisteo-home", "items"));

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

// Signed in, deletions are kept until synced so they reach the other devices.
let keepTombstones = false;

async function write(item: HomeItem) {
  await set(item.id, { ...item, updatedAt: Date.now(), dirty: true }, db());
  notify();
}

/** Applies a change to one item, if it still exists. */
async function change(id: string, update: (item: HomeItem) => HomeItem) {
  const current = await get<HomeItem>(id, db());
  if (!current || current.deletedAt) return;
  await write(update(normalize(current)));
}

const cleanText = (text: string | undefined, max: number) => text?.trim().slice(0, max) || undefined;
const cleanPrice = (value: number | undefined) => (value !== undefined && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined);
const cleanDay = (value: string | undefined) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined);

function cleanFields(fields: HomeItemFields): HomeItemFields {
  return {
    ...fields,
    ...("name" in fields && { name: cleanText(fields.name, 60) }),
    ...("room" in fields && { room: homeRooms.includes(fields.room!) ? fields.room : undefined }),
    ...("category" in fields && { category: homeCategories.includes(fields.category!) ? fields.category : undefined }),
    ...("boughtOn" in fields && { boughtOn: cleanDay(fields.boughtOn) }),
    ...("priceMga" in fields && { priceMga: cleanPrice(fields.priceMga) }),
    ...("store" in fields && { store: cleanText(fields.store, 80) }),
    ...("warrantyUntil" in fields && { warrantyUntil: cleanDay(fields.warrantyUntil) }),
    ...("serial" in fields && { serial: cleanText(fields.serial, 40) }),
    ...("note" in fields && { note: cleanText(fields.note, 500) }),
  };
}

/** Items saved by an older version, or another device: every list present. */
function normalize(item: HomeItem): HomeItem {
  return { ...item, scanIds: Array.isArray(item.scanIds) ? item.scanIds : [] };
}

function blankItem(name: string): HomeItem {
  const now = Date.now();
  return { id: createId(), name, scanIds: [], createdAt: now, updatedAt: now };
}

/** A small photo for the item; undefined when it can't be read. */
export async function homeItemPhoto(src: string | undefined) {
  if (!src) return undefined;
  try {
    return (await encodeImage(src, PHOTO_EDGE, 0.72)).dataUrl;
  } catch {
    return src.startsWith("data:") ? src : undefined;
  }
}

export const homeItemStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  async list(): Promise<HomeItem[]> {
    return (await values<HomeItem>(db())).filter((item) => !item.deletedAt).map(normalize).sort((a, b) => a.createdAt - b.createdAt);
  },

  async get(id: string) {
    const item = await get<HomeItem>(id, db());
    return item && !item.deletedAt ? normalize(item) : undefined;
  },

  /** A thing written in the app. */
  async create(fields: HomeItemFields, fallbackName: string) {
    const cleaned = cleanFields(fields);
    const item: HomeItem = { ...blankItem(cleaned.name || fallbackName), ...cleaned, name: cleaned.name || fallbackName };
    await write(item);
    return item;
  },

  /** A thing made from an object scan, prefilled (name, category, room, serial) and with its photo. */
  async addFromScan(entry: HistoryEntry, fallbackName: string) {
    const fields = itemFieldsFrom(entry.analysis);
    const item: HomeItem = {
      ...blankItem(fields.name || fallbackName),
      ...fields,
      name: fields.name || fallbackName,
      fromScanId: entry.id,
      thumbnail: await homeItemPhoto(entry.preview || entry.thumbnail),
    };
    await write(item);
    return item;
  },

  edit: (id: string, fields: HomeItemFields) =>
    change(id, (item) => {
      const cleaned = cleanFields(fields);
      return { ...item, ...cleaned, name: cleaned.name || item.name };
    }),

  /** Links an invoice, a receipt or a warranty card; fills in the purchase it tells. False when full or linked already. */
  async linkPaper(id: string, entry: Pick<HistoryEntry, "id" | "analysis">) {
    const current = await homeItemStore.get(id);
    const scanIds = current && withPaper(current.scanIds, entry.id);
    if (!scanIds) return false;
    await change(id, (item) => ({ ...fillFromPaper(item, entry.analysis), scanIds }));
    return true;
  },

  unlinkPaper: (id: string, scanId: string) => change(id, (item) => ({ ...item, scanIds: item.scanIds.filter((other) => other !== scanId) })),

  async remove(id: string) {
    const current = await get<HomeItem>(id, db());
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
  raw: () => values<HomeItem>(db()),
  rawGet: (id: string) => get<HomeItem>(id, db()),
  async rawPut(item: HomeItem) {
    await set(item.id, item, db());
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
