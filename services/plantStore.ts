import { clear, createStore, del, get, set, values } from "idb-keyval";
import type { PlantDiagnosis } from "@/lib/ai/schema";
import { cleanWaterDays, MAX_CHECKS, plantFieldsFrom, type Plant, type PlantCheck, type PlantPlace } from "@/lib/plants";
import type { HistoryEntry } from "@/types/history";
import { createId } from "./historyStore";
import { parcelMiniature } from "./parcelStore";

// "Mes plantes": the user's plants, their watering and the problems checked.
// Local-first like "Mon garage"; synced with the account (services/plantSync.ts).
// The logic lives in lib/plants.ts.

export type { Plant } from "@/lib/plants";

/** What the plant form edits. */
export type PlantFields = Partial<Pick<Plant, "name" | "place" | "waterEveryDays" | "lastWateredAt" | "notes" | "thumbnail">>;

let store: ReturnType<typeof createStore> | null = null;
const db = () => (store ??= createStore("assisteo-plants", "plants"));

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

// Signed in, deletions are kept until synced so they reach the other devices.
let keepTombstones = false;

async function write(plant: Plant) {
  await set(plant.id, { ...plant, updatedAt: Date.now(), dirty: true }, db());
  notify();
}

/** Applies a change to one plant, if it still exists. */
async function change(id: string, update: (plant: Plant) => Plant) {
  const current = await get<Plant>(id, db());
  if (!current || current.deletedAt) return;
  await write(update(normalize(current)));
}

const cleanText = (text: string | undefined, max: number) => text?.trim().slice(0, max) || undefined;

function cleanFields(fields: PlantFields): PlantFields {
  return {
    ...fields,
    ...("name" in fields && { name: cleanText(fields.name, 60) }),
    ...("notes" in fields && { notes: cleanText(fields.notes, 500) }),
    ...("waterEveryDays" in fields && { waterEveryDays: cleanWaterDays(fields.waterEveryDays) }),
    ...("place" in fields && { place: fields.place === "outdoor" ? ("outdoor" as PlantPlace) : ("indoor" as PlantPlace) }),
    ...("lastWateredAt" in fields && { lastWateredAt: fields.lastWateredAt && Number.isFinite(fields.lastWateredAt) ? Math.min(fields.lastWateredAt, Date.now()) : undefined }),
  };
}

function blankPlant(name: string): Plant {
  const now = Date.now();
  return { id: createId(), name, place: "indoor", waterEveryDays: cleanWaterDays(undefined), scanIds: [], checks: [], createdAt: now, updatedAt: now };
}

/** Plants saved by an older version, or another device: every list present. */
function normalize(plant: Plant): Plant {
  return { ...plant, place: plant.place ?? "indoor", waterEveryDays: cleanWaterDays(plant.waterEveryDays), scanIds: plant.scanIds ?? [], checks: plant.checks ?? [] };
}

export const plantStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  async list(): Promise<Plant[]> {
    return (await values<Plant>(db())).filter((plant) => !plant.deletedAt).map(normalize).sort((a, b) => a.createdAt - b.createdAt);
  },

  async get(id: string) {
    const plant = await get<Plant>(id, db());
    return plant && !plant.deletedAt ? normalize(plant) : undefined;
  },

  /** A plant written in the app. */
  async create(fields: PlantFields, fallbackName: string) {
    const cleaned = cleanFields(fields);
    const plant: Plant = { ...blankPlant(cleaned.name || fallbackName), ...cleaned, name: cleaned.name || fallbackName };
    await write(plant);
    return plant;
  },

  /** A plant made from a plant scan: its name, place and watering for the season. */
  async addFromScan(entry: HistoryEntry, fallbackName: string) {
    const fields = plantFieldsFrom(entry.analysis, Date.now());
    const plant: Plant = {
      ...blankPlant(fields.name || fallbackName),
      ...fields,
      name: fields.name || fallbackName,
      scanIds: [entry.id],
      thumbnail: await parcelMiniature(entry.thumbnail),
    };
    await write(plant);
    return plant;
  },

  edit: (id: string, fields: PlantFields) =>
    change(id, (plant) => {
      const cleaned = cleanFields(fields);
      return { ...plant, ...cleaned, name: cleaned.name || plant.name };
    }),

  /** "Watered today". */
  water: (id: string, at = Date.now()) => change(id, (plant) => ({ ...plant, lastWateredAt: at })),

  /** A problem checked from a photo: kept newest first, the 10 latest. */
  async addCheck(id: string, diagnosis: PlantDiagnosis, photo?: string) {
    const thumbnail = photo ? await parcelMiniature(photo).catch(() => undefined) : undefined;
    const check: PlantCheck = { ...diagnosis, id: createId(), at: Date.now(), ...(thumbnail && { thumbnail }) };
    await change(id, (plant) => ({ ...plant, checks: [check, ...plant.checks].slice(0, MAX_CHECKS) }));
    return check;
  },

  removeCheck: (id: string, checkId: string) => change(id, (plant) => ({ ...plant, checks: plant.checks.filter((check) => check.id !== checkId) })),

  async remove(id: string) {
    const current = await get<Plant>(id, db());
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
  raw: () => values<Plant>(db()),
  rawGet: (id: string) => get<Plant>(id, db()),
  async rawPut(plant: Plant) {
    await set(plant.id, plant, db());
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
