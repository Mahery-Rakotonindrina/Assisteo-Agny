import { clear, createStore, del, get, set, values } from "idb-keyval";
import type { ParcelStatus, ShippingMode } from "@/lib/ai/schema";
import { encodeImage } from "@/lib/image";
import { isNewerParcel, sameParcel, type ParcelInfo } from "@/lib/parcels";
import type { HistoryEntry } from "@/types/history";
import { createId } from "./historyStore";

// "Mes colis": parcels the user chose to follow. Each keeps the latest known
// state plus a timeline of the statuses seen on successive screenshots.
// Local-first like the history; synced with the account (services/parcelSync.ts).

export type ParcelTimelineEntry = {
  /** When this status was recorded (scan time, or edit time). */
  at: number;
  status: ParcelStatus;
  statusLabel: string;
  event: ParcelInfo["lastEvent"];
  /** The scan that showed it; empty when the user set it by hand. */
  scanId: string;
};

/** A cost paid in ariary on top of the item: freight, customs, delivery… */
export type ParcelFee = { id: string; label: string; amountMga: number };

export type Parcel = {
  id: string;
  title: string;
  /** Who the parcel is for (a family member, a customer…). */
  client?: string;
  /** Sea or air, chosen by the user; otherwise read on the scans or guessed (see shippingModeOf). */
  shippingMode?: ShippingMode;
  /**
   * A small copy of its first scan's photo (JPEG data URL), kept with the
   * parcel so it stays recognisable once the scans are deleted.
   */
  thumbnail?: string;
  info: ParcelInfo;
  /** Scans of this parcel, oldest first. */
  scanIds: string[];
  timeline: ParcelTimelineEntry[];
  createdAt: number;
  updatedAt: number;
  /**
   * Marked as received by hand, i.e. in the user's hands (in Madagascar).
   * Independent of the carrier's "delivered", which often means a
   * forwarding warehouse abroad.
   */
  receivedAt?: number;
  /** What the item cost, in ariary (entered by the user). */
  priceMga?: number;
  /** Extra costs in ariary: freight, customs, local delivery… */
  fees?: ParcelFee[];
  /** Resellers (Pro): what the client is charged, and what they have paid so far, in ariary. */
  salePriceMga?: number;
  paidMga?: number;
  /** Sync bookkeeping, like the history. */
  deletedAt?: number;
  dirty?: boolean;
};

let store: ReturnType<typeof createStore> | null = null;
const db = () => (store ??= createStore("assisteo-parcels", "parcels"));

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

// Signed in, deletions are kept until synced so they reach the other devices.
let keepTombstones = false;

const timelineEntry = (entry: HistoryEntry, info: ParcelInfo): ParcelTimelineEntry => ({
  at: entry.createdAt,
  status: info.status,
  statusLabel: info.statusLabel,
  event: info.lastEvent,
  scanId: entry.id,
});

/** Edge of a parcel's own photo: a list thumbnail, a few kilobytes. */
const MINIATURE_EDGE = 128;

/**
 * A parcel-sized copy of a scan's thumbnail. Only data URLs are kept (a
 * remote link would expire); without a canvas (tests) the thumbnail is kept as is.
 */
export async function parcelMiniature(thumbnail: string | undefined) {
  if (!thumbnail?.startsWith("data:")) return undefined;
  try {
    return (await encodeImage(thumbnail, MINIATURE_EDGE, 0.72)).dataUrl;
  } catch {
    return thumbnail;
  }
}

async function write(parcel: Parcel) {
  await set(parcel.id, { ...parcel, updatedAt: Date.now(), dirty: true }, db());
  notify();
}

export const parcelStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** Followed parcels, most recently updated first. */
  async list(): Promise<Parcel[]> {
    return (await values<Parcel>(db())).filter((parcel) => !parcel.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt);
  },

  /** The followed parcel this scan belongs to, if any. */
  async findFor(info: ParcelInfo | null | undefined) {
    if (!info) return undefined;
    return (await parcelStore.list()).find((parcel) => sameParcel(parcel.info, info));
  },

  /** Starts following the parcel shown on this scan. */
  async add(entry: HistoryEntry) {
    const info = entry.analysis.parcel;
    if (!info) throw new Error("This scan is not a parcel.");
    const existing = await parcelStore.findFor(info);
    if (existing) return existing;
    const now = Date.now();
    const parcel: Parcel = {
      id: createId(),
      title: entry.analysis.title,
      thumbnail: await parcelMiniature(entry.thumbnail),
      info,
      scanIds: [entry.id],
      timeline: [timelineEntry(entry, info)],
      createdAt: now,
      updatedAt: now,
    };
    await write(parcel);
    return parcel;
  },

  /** Records the status shown on a newer scan of a followed parcel. */
  async applyScan(parcel: Parcel, entry: HistoryEntry) {
    const info = entry.analysis.parcel;
    if (!info) return parcel;
    const next: Parcel = {
      ...parcel,
      thumbnail: parcel.thumbnail ?? (await parcelMiniature(entry.thumbnail)),
      // Fields missing on the new screenshot keep their earlier value.
      info: {
        ...parcel.info,
        ...Object.fromEntries(Object.entries(info).filter(([, value]) => value !== null && !(Array.isArray(value) && value.length === 0))),
      } as ParcelInfo,
      scanIds: parcel.scanIds.includes(entry.id) ? parcel.scanIds : [...parcel.scanIds, entry.id],
      timeline: parcel.timeline.some((item) => item.scanId === entry.id) ? parcel.timeline : [...parcel.timeline, timelineEntry(entry, info)],
    };
    await write(next);
    return next;
  },

  async markReceived(parcel: Parcel, received: boolean) {
    await write({ ...parcel, receivedAt: received ? Date.now() : undefined });
  },

  /**
   * Saves the user's corrections. A status changed by hand is added to the
   * timeline, like a scan would. `receivedAt`: a date corrects when the parcel
   * was picked up (and marks it received), null marks it not received,
   * absent keeps it. `shippingMode`: null goes back to automatic, absent keeps it.
   */
  async edit(id: string, changes: { title: string; client?: string; info: ParcelInfo; receivedAt?: number | null; shippingMode?: ShippingMode | null }) {
    const current = await get<Parcel>(id, db());
    if (!current) return;
    const statusChanged = changes.info.status !== current.info.status;
    await write({
      ...current,
      title: changes.title.trim() || current.title,
      client: changes.client?.trim() || undefined,
      info: changes.info,
      receivedAt: changes.receivedAt === undefined ? current.receivedAt : (changes.receivedAt ?? undefined),
      shippingMode: changes.shippingMode === undefined ? current.shippingMode : (changes.shippingMode ?? undefined),
      timeline: statusChanged
        ? [...current.timeline, { at: Date.now(), status: changes.info.status, statusLabel: changes.info.statusLabel, event: changes.info.lastEvent, scanId: "" }]
        : current.timeline,
    });
  },

  /** Gives a parcel its own photo (see keepParcelThumbnails). */
  async setThumbnail(id: string, thumbnail: string) {
    const current = await get<Parcel>(id, db());
    if (!current || current.thumbnail) return;
    await write({ ...current, thumbnail });
  },

  /** Saves what the client is charged and has paid (resellers). */
  async setSale(id: string, sale: { salePriceMga?: number; paidMga?: number }) {
    const current = await get<Parcel>(id, db());
    if (!current) return;
    await write({ ...current, salePriceMga: sale.salePriceMga, paidMga: sale.paidMga });
  },

  /** Saves the price and fees in ariary. */
  async setCosts(id: string, costs: { priceMga?: number; fees: ParcelFee[] }) {
    const current = await get<Parcel>(id, db());
    if (!current) return;
    await write({ ...current, priceMga: costs.priceMga, fees: costs.fees });
  },

  async remove(id: string) {
    const current = await get<Parcel>(id, db());
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
  raw: () => values<Parcel>(db()),
  rawGet: (id: string) => get<Parcel>(id, db()),
  async rawPut(parcel: Parcel) {
    await set(parcel.id, parcel, db());
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

/** Whether this scan shows a later state than what the followed parcel has. */
export function hasNewStatus(parcel: Parcel, info: ParcelInfo | null | undefined) {
  return Boolean(info && isNewerParcel(parcel.info, info));
}

/** Everything spent on a parcel, in ariary: price plus fees. */
export function parcelTotalMga(parcel: Pick<Parcel, "priceMga" | "fees">) {
  return (parcel.priceMga ?? 0) + (parcel.fees ?? []).reduce((total, fee) => total + (fee.amountMga || 0), 0);
}

/** What the client still owes, in ariary (0 without a sale price). */
export function parcelDueMga(parcel: Pick<Parcel, "salePriceMga" | "paidMga">) {
  return parcel.salePriceMga ? Math.max(0, parcel.salePriceMga - (parcel.paidMga ?? 0)) : 0;
}

/** The sale price minus everything spent, or null without a sale price. */
export function parcelProfitMga(parcel: Pick<Parcel, "salePriceMga" | "priceMga" | "fees">) {
  return parcel.salePriceMga ? parcel.salePriceMga - parcelTotalMga(parcel) : null;
}
