import { clear, createStore, del, get, set, values } from "idb-keyval";
import {
  DEFAULT_NOTICE_DAYS,
  defaultVehicleName,
  vehicleFieldsFrom,
  type FuelEntry,
  type MaintenanceEntry,
  type Vehicle,
  type VehicleExpense,
  type VehicleReminderKind,
} from "@/lib/garage";
import type { HistoryEntry } from "@/types/history";
import { createId } from "./historyStore";
import { parcelMiniature } from "./parcelStore";

// "Mon garage": the user's vehicles with their service log, fuel fills and
// expenses. Local-first like the lists; synced with the account
// (services/vehicleSync.ts). The logic lives in lib/garage.ts.

export type { Vehicle } from "@/lib/garage";

/** What the vehicle form edits. */
export type VehicleFields = Partial<
  Pick<
    Vehicle,
    | "name"
    | "kind"
    | "make"
    | "model"
    | "year"
    | "plate"
    | "vin"
    | "energy"
    | "fiscalPower"
    | "insuranceUntil"
    | "inspectionUntil"
    | "noticeDays"
    | "oilIntervalKm"
    | "oilIntervalMonths"
  >
>;

let store: ReturnType<typeof createStore> | null = null;
const db = () => (store ??= createStore("assisteo-vehicles", "vehicles"));

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

// Signed in, deletions are kept until synced so they reach the other devices.
let keepTombstones = false;

async function write(vehicle: Vehicle) {
  await set(vehicle.id, { ...vehicle, updatedAt: Date.now(), dirty: true }, db());
  notify();
}

/** Applies a change to one vehicle, if it still exists. */
async function change(id: string, update: (vehicle: Vehicle) => Vehicle) {
  const current = await get<Vehicle>(id, db());
  if (!current || current.deletedAt) return;
  await write(update(current));
}

const cleanText = (text: string | undefined, max = 120) => text?.trim().slice(0, max) || undefined;

/** A number typed by the user: positive and finite, else none. */
const cleanNumber = (value: number | undefined, { round = true } = {}) =>
  value !== undefined && Number.isFinite(value) && value > 0 ? (round ? Math.round(value) : Math.round(value * 100) / 100) : undefined;

const cleanDay = (value: string | undefined) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined);

function cleanFields(fields: VehicleFields): VehicleFields {
  return {
    ...fields,
    ...("name" in fields && { name: cleanText(fields.name, 60) }),
    ...("make" in fields && { make: cleanText(fields.make, 60) }),
    ...("model" in fields && { model: cleanText(fields.model, 60) }),
    ...("plate" in fields && { plate: cleanText(fields.plate, 20) }),
    ...("vin" in fields && { vin: cleanText(fields.vin, 30) }),
    ...("year" in fields && { year: cleanNumber(fields.year) }),
    ...("fiscalPower" in fields && { fiscalPower: cleanNumber(fields.fiscalPower) }),
    ...("insuranceUntil" in fields && { insuranceUntil: cleanDay(fields.insuranceUntil) }),
    ...("inspectionUntil" in fields && { inspectionUntil: cleanDay(fields.inspectionUntil) }),
    ...("oilIntervalKm" in fields && { oilIntervalKm: cleanNumber(fields.oilIntervalKm) }),
    ...("oilIntervalMonths" in fields && { oilIntervalMonths: cleanNumber(fields.oilIntervalMonths) }),
    ...("noticeDays" in fields && { noticeDays: cleanNumber(fields.noticeDays) ?? DEFAULT_NOTICE_DAYS }),
  };
}

function blankVehicle(name: string): Vehicle {
  const now = Date.now();
  return {
    id: createId(),
    name,
    kind: "car",
    scanIds: [],
    noticeDays: DEFAULT_NOTICE_DAYS,
    odometer: [],
    maintenance: [],
    fuel: [],
    expenses: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** Vehicles saved by an older version, or another device: every list present. */
function normalize(vehicle: Vehicle): Vehicle {
  return {
    ...vehicle,
    scanIds: vehicle.scanIds ?? [],
    noticeDays: vehicle.noticeDays ?? DEFAULT_NOTICE_DAYS,
    odometer: vehicle.odometer ?? [],
    maintenance: vehicle.maintenance ?? [],
    fuel: vehicle.fuel ?? [],
    expenses: vehicle.expenses ?? [],
  };
}

const byDate = <T extends { at: number }>(items: T[]) => [...items].sort((a, b) => b.at - a.at);

export const vehicleStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  async list(): Promise<Vehicle[]> {
    return (await values<Vehicle>(db())).filter((vehicle) => !vehicle.deletedAt).map(normalize).sort((a, b) => a.createdAt - b.createdAt);
  },

  async get(id: string) {
    const vehicle = await get<Vehicle>(id, db());
    return vehicle && !vehicle.deletedAt ? normalize(vehicle) : undefined;
  },

  /** A vehicle written in the app. */
  async create(fields: VehicleFields & { km?: number }, fallbackName: string) {
    const { km, ...rest } = fields;
    const cleaned = cleanFields(rest);
    const vehicle: Vehicle = { ...blankVehicle(cleaned.name || fallbackName), ...cleaned, name: cleaned.name || fallbackName };
    const reading = cleanNumber(km);
    if (reading !== undefined) vehicle.odometer = [{ at: Date.now(), km: reading }];
    await write(vehicle);
    return vehicle;
  },

  /** A vehicle made from a vehicle scan or a registration certificate, prefilled. */
  async addFromScan(entry: HistoryEntry, fallbackName: string) {
    const fields = vehicleFieldsFrom(entry.analysis);
    const vehicle: Vehicle = {
      ...blankVehicle(defaultVehicleName(fields, fallbackName)),
      ...fields,
      scanIds: [entry.id],
      thumbnail: await parcelMiniature(entry.thumbnail),
    };
    await write(vehicle);
    return vehicle;
  },

  /** Fills a vehicle in with what a scan read (the scan's values win), and links the scan. */
  async updateFromScan(id: string, entry: HistoryEntry) {
    const fields = vehicleFieldsFrom(entry.analysis);
    const thumbnail = await parcelMiniature(entry.thumbnail);
    await change(id, (vehicle) => ({
      ...vehicle,
      ...fields,
      // The user's own name and kind stay.
      name: vehicle.name,
      kind: vehicle.kind,
      thumbnail: vehicle.thumbnail ?? thumbnail,
      scanIds: vehicle.scanIds.includes(entry.id) ? vehicle.scanIds : [...vehicle.scanIds, entry.id],
    }));
  },

  edit: (id: string, fields: VehicleFields) =>
    change(id, (vehicle) => {
      const cleaned = cleanFields(fields);
      return { ...vehicle, ...cleaned, name: cleaned.name || vehicle.name };
    }),

  /** The odometer read now (or on a given day). */
  async addReading(id: string, km: number, at = Date.now()) {
    const value = cleanNumber(km);
    if (value === undefined) return;
    await change(id, (vehicle) => ({ ...vehicle, odometer: [...vehicle.odometer, { at, km: value }].sort((a, b) => a.at - b.at) }));
  },

  async saveMaintenance(id: string, entry: Omit<MaintenanceEntry, "id"> & { id?: string }) {
    const clean: MaintenanceEntry = {
      id: entry.id ?? createId(),
      at: entry.at,
      kind: entry.kind,
      km: cleanNumber(entry.km),
      costMga: cleanNumber(entry.costMga),
      garage: cleanText(entry.garage, 80),
      note: cleanText(entry.note, 300),
    };
    await change(id, (vehicle) => ({ ...vehicle, maintenance: byDate([...vehicle.maintenance.filter((item) => item.id !== clean.id), clean]) }));
  },

  removeMaintenance: (id: string, entryId: string) => change(id, (vehicle) => ({ ...vehicle, maintenance: vehicle.maintenance.filter((item) => item.id !== entryId) })),

  async saveFuel(id: string, fill: Omit<FuelEntry, "id"> & { id?: string }) {
    const km = cleanNumber(fill.km);
    const litres = cleanNumber(fill.litres, { round: false });
    if (km === undefined || litres === undefined) return;
    const clean: FuelEntry = { id: fill.id ?? createId(), at: fill.at, km, litres, amountMga: cleanNumber(fill.amountMga), full: fill.full };
    await change(id, (vehicle) => ({ ...vehicle, fuel: byDate([...vehicle.fuel.filter((item) => item.id !== clean.id), clean]) }));
  },

  removeFuel: (id: string, fillId: string) => change(id, (vehicle) => ({ ...vehicle, fuel: vehicle.fuel.filter((item) => item.id !== fillId) })),

  async saveExpense(id: string, expense: Omit<VehicleExpense, "id"> & { id?: string }) {
    const amountMga = cleanNumber(expense.amountMga);
    if (amountMga === undefined) return;
    const clean: VehicleExpense = { id: expense.id ?? createId(), at: expense.at, kind: expense.kind, label: cleanText(expense.label, 80), amountMga };
    await change(id, (vehicle) => ({ ...vehicle, expenses: byDate([...vehicle.expenses.filter((item) => item.id !== clean.id), clean]) }));
  },

  removeExpense: (id: string, expenseId: string) => change(id, (vehicle) => ({ ...vehicle, expenses: vehicle.expenses.filter((item) => item.id !== expenseId) })),

  /** "Remind me later" for one of its reminders. */
  snooze: (id: string, kind: VehicleReminderKind, at: number) => change(id, (vehicle) => ({ ...vehicle, snoozed: { ...vehicle.snoozed, [kind]: at } })),

  async remove(id: string) {
    const current = await get<Vehicle>(id, db());
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
  raw: () => values<Vehicle>(db()),
  rawGet: (id: string) => get<Vehicle>(id, db()),
  async rawPut(vehicle: Vehicle) {
    await set(vehicle.id, vehicle, db());
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
