import { clear, createStore, del, get, set, values } from "idb-keyval";
import { readMeasure, type Measure, type MeasureFields } from "@/lib/measures";
import { createId } from "./historyStore";
import { removeRecords } from "./storeRemoval";
import { forgetSyncCursor } from "./syncCursor";

// "Mes mesures" (Ma santé): blood pressure, blood sugar and weight, one record
// each. Local-first like the shop; synced with the account
// (services/measureSync.ts, table "health_measures"). The logic lives in
// lib/measures.ts.

export type { Measure } from "@/lib/measures";

export const MEASURE_TABLE = "health_measures";

let store: ReturnType<typeof createStore> | null = null;
const db = () => (store ??= createStore("assisteo-measures", "measures"));

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

// Signed in, deletions are kept until synced so they reach the other devices.
let keepTombstones = false;

async function write(measure: Measure) {
  await set(measure.id, { ...measure, updatedAt: Date.now(), dirty: true }, db());
  notify();
}

export const measureStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** Every measure still there, oldest first. */
  async list(): Promise<Measure[]> {
    return (await values<Measure>(db()))
      .filter((measure) => !measure.deletedAt)
      .map(readMeasure)
      .filter((measure): measure is Measure => measure !== null)
      .sort((a, b) => a.at - b.at);
  },

  async add(fields: MeasureFields) {
    const now = Date.now();
    const measure: Measure = { ...fields, id: createId(), createdAt: now, updatedAt: now };
    await write(measure);
    return measure;
  },

  /** Changed: the fields replaced (a value, the moment, the note, whose it is). */
  async edit(id: string, fields: MeasureFields) {
    const current = await get<Measure>(id, db());
    if (!current || current.deletedAt) return;
    await write({ id, createdAt: current.createdAt, updatedAt: current.updatedAt, ...fields });
  },

  async remove(id: string) {
    const current = await get<Measure>(id, db());
    if (!current) return;
    if (keepTombstones) await write({ ...current, deletedAt: Date.now() });
    else {
      await del(id, db());
      notify();
    }
  },

  /** "Remettre à zéro" (with the rest of Ma santé): every measure (synced like any removal). */
  async removeAll() {
    await removeRecords(db(), (await values<Measure>(db())).filter((measure) => !measure.deletedAt), keepTombstones);
    notify();
  },

  /** A relative removed: their measures come back to "Moi". */
  async reassign(profileId: string) {
    for (const measure of await values<Measure>(db())) {
      if (measure.profileId !== profileId || measure.deletedAt) continue;
      const { profileId: _gone, ...rest } = measure;
      await set(measure.id, { ...rest, updatedAt: Date.now(), dirty: true }, db());
    }
    notify();
  },

  // ---- For the sync engine -----------------------------------------------------

  setKeepTombstones(value: boolean) {
    keepTombstones = value;
  },
  raw: () => values<Measure>(db()),
  rawGet: (id: string) => get<Measure>(id, db()),
  async rawPut(measure: Measure) {
    await set(measure.id, measure, db());
  },
  async rawDelete(id: string) {
    await del(id, db());
  },
  notify,
  /** Signing out or deleting the account. */
  async wipe() {
    await clear(db());
    // The next sync reads everything again.
    forgetSyncCursor(MEASURE_TABLE);
    notify();
  },
};
