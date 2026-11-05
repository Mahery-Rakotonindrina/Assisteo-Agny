import { clear, createStore, del, get, set, values } from "idb-keyval";
import { acceptSharedParcel, isOwnShare, parcelShareId, parcelShareUpdates, parcelSnapshot, type SharedParcelRecord } from "@/lib/householdShares";
import type { Parcel } from "./parcelStore";
import { createRowSync } from "./rowSync";

// "Mes colis" shared with the household (table "household_shares", kind
// "parcel"): a copy of the parcel, without what it cost, written again by its
// author's device when the parcel changes (SharedParcelKeeper) and read only
// for the others. Its author stops sharing it; its parcel removed, it stops too.

let store: ReturnType<typeof createStore> | null = null;
const db = () => (store ??= createStore("assisteo-household-parcels", "parcels"));

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

// Signed in, deletions are kept until synced so they reach the other members.
let keepTombstones = false;

async function write(record: SharedParcelRecord) {
  await set(record.id, { ...record, updatedAt: Date.now(), dirty: true }, db());
  notify();
}

export const sharedParcelStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  async list(): Promise<SharedParcelRecord[]> {
    return (await values<SharedParcelRecord & { deletedAt?: number }>(db())).filter((record) => !record.deletedAt);
  },

  /** The copy of this parcel shared by the user, if any. */
  async shareOf(parcelId: string) {
    const record = await get<SharedParcelRecord & { deletedAt?: number }>(parcelShareId(parcelId), db());
    return record && !record.deletedAt ? record : undefined;
  },

  async remove(id: string) {
    const record = await get<SharedParcelRecord>(id, db());
    if (!record) return;
    if (keepTombstones) await set(id, { ...record, updatedAt: Date.now(), deletedAt: Date.now(), dirty: true }, db());
    else await del(id, db());
    notify();
  },

  // ---- For the sync engine -----------------------------------------------------

  setKeepTombstones(value: boolean) {
    keepTombstones = value;
  },
  raw: () => values<SharedParcelRecord & { deletedAt?: number }>(db()),
  rawGet: (id: string) => get<SharedParcelRecord & { deletedAt?: number }>(id, db()),
  async rawPut(record: SharedParcelRecord) {
    await set(record.id, record, db());
  },
  async rawDelete(id: string) {
    await del(id, db());
  },
  notify,
  async wipe() {
    await clear(db());
    notify();
  },
};

/** Shares a parcel with the household: a copy without its costs. */
export async function shareParcel(parcel: Parcel, householdId: string, me: string) {
  await write({ ...parcelSnapshot(parcel, householdId, me), updatedAt: Date.now() });
}

/** Stops sharing one's own parcel (the parcel itself stays). */
export async function unshareParcel(parcelId: string) {
  await sharedParcelStore.remove(parcelShareId(parcelId));
}

/** After a change of the user's parcels: their copies follow (never stopped here, see parcelShareUpdates). */
export async function refreshSharedParcels(parcels: Parcel[], me: string | null) {
  for (const parcel of parcelShareUpdates(await sharedParcelStore.list(), parcels, me)) {
    const current = await sharedParcelStore.shareOf(parcel.id);
    if (current?.householdId && current.userId) await shareParcel(parcel, current.householdId, current.userId);
  }
}

/** Parcels the user removed: their own shares stop (another member's copy never). */
export async function stopSharesOf(parcelIds: string[], me: string | null) {
  for (const parcelId of parcelIds) {
    const share = await sharedParcelStore.shareOf(parcelId);
    if (share && isOwnShare(share, me)) await sharedParcelStore.remove(share.id);
  }
}

/** Out of the household: the copies go (the parcels themselves never left). */
export const detachSharedParcels = () => sharedParcelStore.wipe();

const parcelSync = (uid: string, householdId: string) =>
  createRowSync<SharedParcelRecord & { deletedAt?: number }>("household_shares", sharedParcelStore, {
    match: { household_id: householdId, kind: "parcel" },
    withAuthor: (record, userId) => (userId ? { ...record, userId } : record),
    // Each one writes only their own copies.
    canPush: (record) => isOwnShare(record, uid),
    accept: (record) => acceptSharedParcel(record),
  });

/** Keeps the household's parcels synced while a member. Returns the stop function. */
export const startSharedParcelSync = (uid: string, householdId: string) => parcelSync(uid, householdId).start(uid);

export const syncSharedParcels = (uid: string, householdId: string) => parcelSync(uid, householdId).sync(uid);
