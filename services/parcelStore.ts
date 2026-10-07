import { clear, createStore, del, get, set, values } from "idb-keyval";
import type { ParcelStatus } from "@/lib/ai/schema";
import { isNewerParcel, sameParcel, type ParcelInfo } from "@/lib/parcels";
import type { HistoryEntry } from "@/types/history";
import { createId } from "./historyStore";

// "Mes colis": parcels the user chose to follow. Each keeps the latest known
// state plus a timeline of the statuses seen on successive screenshots.
// Local-first like the history; synced with the account (services/parcelSync.ts).

export type ParcelTimelineEntry = {
  /** When this status was recorded (scan time). */
  at: number;
  status: ParcelStatus;
  statusLabel: string;
  event: ParcelInfo["lastEvent"];
  scanId: string;
};

export type Parcel = {
  id: string;
  title: string;
  info: ParcelInfo;
  /** Scans of this parcel, oldest first. */
  scanIds: string[];
  timeline: ParcelTimelineEntry[];
  createdAt: number;
  updatedAt: number;
  /** Marked as received by hand (the shop may never say "delivered"). */
  receivedAt?: number;
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
      // Fields missing on the new screenshot keep their earlier value.
      info: {
        ...parcel.info,
        ...Object.fromEntries(Object.entries(info).filter(([, value]) => value !== null && !(Array.isArray(value) && value.length === 0))),
      } as ParcelInfo,
      scanIds: parcel.scanIds.includes(entry.id) ? parcel.scanIds : [...parcel.scanIds, entry.id],
      timeline: parcel.timeline.some((item) => item.scanId === entry.id) ? parcel.timeline : [...parcel.timeline, timelineEntry(entry, info)],
      receivedAt: info.status === "delivered" ? (parcel.receivedAt ?? Date.now()) : parcel.receivedAt,
    };
    await write(next);
    return next;
  },

  async markReceived(parcel: Parcel, received: boolean) {
    await write({ ...parcel, receivedAt: received ? Date.now() : undefined });
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
