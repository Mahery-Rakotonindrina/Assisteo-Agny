import type { Analysis, VehicleEnergy } from "@/lib/ai/schema";
import { startOfMonth } from "@/lib/bills";
import { parseNumber } from "@/lib/money";
import { parseDay } from "@/lib/papers";

// "Mon garage": the user's vehicles, their service log, fuel fills and
// expenses, and the reminders worked out from them (insurance, technical
// inspection, oil change estimated from the odometer readings). Pure, so it
// is shared by the store, the screens and the tests.

export const vehicleKinds = ["car", "motorbike", "other"] as const;
export type VehicleKind = (typeof vehicleKinds)[number];

export const maintenanceKinds = ["oil", "tyres", "brakes", "battery", "inspection", "other"] as const;
export type MaintenanceKind = (typeof maintenanceKinds)[number];

export const expenseKinds = ["insurance", "other"] as const;
export type ExpenseKind = (typeof expenseKinds)[number];

export type MaintenanceEntry = {
  id: string;
  /** The day it was done (local midnight). */
  at: number;
  kind: MaintenanceKind;
  km?: number;
  costMga?: number;
  garage?: string;
  note?: string;
};

export type FuelEntry = {
  id: string;
  at: number;
  /** The odometer at the pump. */
  km: number;
  litres: number;
  amountMga?: number;
  /** Filled to the brim: the consumption is measured between two full fills. */
  full: boolean;
};

/** Insurance paid, parking, a fine, a wash… */
export type VehicleExpense = { id: string; at: number; kind: ExpenseKind; label?: string; amountMga: number };

/** The odometer read by the user, apart from fills and services. */
export type OdometerReading = { at: number; km: number };

export type VehicleReminderKind = "insurance" | "inspection" | "oilChange" | "odometer";

export type Vehicle = {
  id: string;
  /** What the user calls it: "La Corolla", "Moto de Rado". */
  name: string;
  kind: VehicleKind;
  make?: string;
  model?: string;
  generation?: string;
  year?: number;
  plate?: string;
  vin?: string;
  energy?: VehicleEnergy;
  fiscalPower?: number;
  /** Date of first registration, YYYY-MM-DD (from the registration certificate). */
  firstRegistration?: string;
  /** A small copy of a scan's photo, so the vehicle stays recognisable. */
  thumbnail?: string;
  /** Scans it was made or updated from. */
  scanIds: string[];
  /** Maintenance advice read on the vehicle scan (task and usual interval). */
  advice?: Array<{ task: string; interval: string }>;
  /** End of the insurance cover and of the technical inspection, YYYY-MM-DD. */
  insuranceUntil?: string;
  inspectionUntil?: string;
  /** How many days before those dates (and the estimated oil change) to remind. */
  noticeDays: number;
  oilIntervalKm?: number;
  oilIntervalMonths?: number;
  odometer: OdometerReading[];
  maintenance: MaintenanceEntry[];
  fuel: FuelEntry[];
  expenses: VehicleExpense[];
  /** "Remind me later": the reminder of that kind comes back at this time. */
  snoozed?: Partial<Record<VehicleReminderKind, number>>;
  createdAt: number;
  updatedAt: number;
  /** Sync bookkeeping, like the parcels and the lists. */
  deletedAt?: number;
  dirty?: boolean;
};

export const DEFAULT_NOTICE_DAYS = 5;
export const NOTICE_DAY_CHOICES = [1, 3, 5, 7, 15, 30];
/** Without a reading for this long, the app asks for the odometer. */
export const ODOMETER_STALE_DAYS = 30;
/** Reminders come at this hour (local time), like the insurance one. */
export const REMINDER_HOUR = 9;

const DAY = 86_400_000;
/** Readings older than this before the latest one don't count in the average. */
const RATE_WINDOW_DAYS = 180;
/** The average needs readings spread over at least this many days. */
const RATE_MIN_DAYS = 7;

// ---- Odometer ---------------------------------------------------------------

/** Every odometer reading known: fills, services with a km, and manual updates, oldest first. */
export function odometerReadings(vehicle: Pick<Vehicle, "odometer" | "fuel" | "maintenance">): OdometerReading[] {
  const readings = [
    ...vehicle.odometer,
    ...vehicle.fuel.map(({ at, km }) => ({ at, km })),
    ...vehicle.maintenance.filter((entry) => entry.km !== undefined).map(({ at, km }) => ({ at, km: km! })),
  ];
  return readings.filter((reading) => Number.isFinite(reading.km) && reading.km >= 0).sort((a, b) => a.at - b.at || a.km - b.km);
}

/** The latest reading (the highest km on the latest day); null without any. */
export function latestReading(vehicle: Pick<Vehicle, "odometer" | "fuel" | "maintenance">) {
  return odometerReadings(vehicle).at(-1) ?? null;
}

/**
 * Average km driven per day, from the readings of the last six months before
 * the latest one; null when they span less than a week or don't go up.
 */
export function kmPerDay(vehicle: Pick<Vehicle, "odometer" | "fuel" | "maintenance">) {
  const readings = odometerReadings(vehicle);
  const last = readings.at(-1);
  if (!last) return null;
  const first = readings.find((reading) => reading.at >= last.at - RATE_WINDOW_DAYS * DAY);
  if (!first) return null;
  const days = (last.at - first.at) / DAY;
  const km = last.km - first.km;
  if (days < RATE_MIN_DAYS || km <= 0) return null;
  return km / days;
}

// ---- Fuel ------------------------------------------------------------------

/**
 * Consumption in L/100 km, measured between two full fills: the litres put in
 * after the first one (partial fills included) over the km driven. `last` is
 * the latest such stretch, `average` all of them together; null until two
 * full fills. `costPerKm` is the fuel paid over those km, in ariary.
 */
export function fuelConsumption(fills: FuelEntry[]) {
  const sorted = [...fills].sort((a, b) => a.km - b.km || a.at - b.at);
  let previousFull: FuelEntry | null = null;
  let litres = 0;
  let amount = 0;
  let pricedKm = 0;
  let totalLitres = 0;
  let totalKm = 0;
  let totalAmount = 0;
  let last: number | null = null;
  // Amounts only count when every fill of the stretch has one.
  let allPriced = true;

  for (const fill of sorted) {
    if (previousFull) {
      litres += fill.litres;
      if (fill.amountMga) amount += fill.amountMga;
      else allPriced = false;
    }
    if (!fill.full) continue;
    if (previousFull) {
      const km = fill.km - previousFull.km;
      if (km > 0 && litres > 0) {
        totalLitres += litres;
        totalKm += km;
        last = (litres / km) * 100;
        if (allPriced) {
          totalAmount += amount;
          pricedKm += km;
        }
      }
    }
    previousFull = fill;
    litres = 0;
    amount = 0;
    allPriced = true;
  }

  return {
    last,
    average: totalKm > 0 ? (totalLitres / totalKm) * 100 : null,
    costPerKm: pricedKm > 0 ? totalAmount / pricedKm : null,
    km: totalKm,
  };
}

// ---- Oil change ------------------------------------------------------------

/** The last oil change in the service log, if any. */
export function lastOilChange(vehicle: Pick<Vehicle, "maintenance">) {
  return [...vehicle.maintenance].filter((entry) => entry.kind === "oil").sort((a, b) => b.at - a.at)[0] ?? null;
}

const addMonths = (timestamp: number, months: number) => {
  const date = new Date(timestamp);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  date.setDate(Math.min(day, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()));
  return date.getTime();
};

export type OilChangeEstimate = {
  /** The km it is due at; null without a km on the last oil change (or no km interval). */
  dueKm: number | null;
  /** When it is expected: by the km at the average pace, or the months, whichever comes first. */
  dueAt: number;
  /** The date comes from the km estimate (else from the months). */
  byKm: boolean;
};

/**
 * When the next oil change is due. The app doesn't see the odometer: from the
 * last oil change and the km driven per day (readings), it estimates the day
 * the interval in km is reached. The interval in months is the fallback (and
 * wins when it comes first). Null without a last oil change or an interval.
 */
export function oilChangeEstimate(vehicle: Pick<Vehicle, "maintenance" | "odometer" | "fuel" | "oilIntervalKm" | "oilIntervalMonths">): OilChangeEstimate | null {
  const last = lastOilChange(vehicle);
  if (!last) return null;
  const dueKm = last.km !== undefined && vehicle.oilIntervalKm ? last.km + vehicle.oilIntervalKm : null;
  const byMonths = vehicle.oilIntervalMonths ? addMonths(last.at, vehicle.oilIntervalMonths) : null;

  let byKmAt: number | null = null;
  if (dueKm !== null) {
    const reading = latestReading(vehicle);
    const rate = kmPerDay(vehicle);
    if (reading && reading.km >= dueKm) byKmAt = reading.at;
    else if (reading && rate) byKmAt = reading.at + Math.round(((dueKm - reading.km) / rate) * DAY);
  }

  if (byKmAt === null && byMonths === null) return null;
  if (byKmAt !== null && (byMonths === null || byKmAt <= byMonths)) return { dueKm, dueAt: byKmAt, byKm: true };
  return { dueKm, dueAt: byMonths!, byKm: false };
}

/** "15 000 km ou 1 an" → the oil change interval read on a vehicle scan's maintenance advice. */
export function oilIntervalFrom(advice: Array<{ task: string; interval: string }>) {
  const oil = advice.find((item) => /vidange|huile|oil/i.test(item.task));
  if (!oil) return {};
  const kmText = oil.interval.match(/(\d[\d\s.,']*)\s*(k\s*)?km/i);
  const km = kmText ? parseNumber(kmText[1]) : null;
  const yearText = oil.interval.match(/(\d+)\s*(an|ans|year|years)\b/i);
  const monthText = oil.interval.match(/(\d+)\s*(mois|months?)\b/i);
  const months = monthText ? Number(monthText[1]) : yearText ? Number(yearText[1]) * 12 : /\b(an|year|yearly|annual)\b/i.test(oil.interval) ? 12 : null;
  return {
    ...(km && { km: Math.round(kmText?.[2] ? km * 1000 : km) }),
    ...(months && { months }),
  };
}

// ---- Reminders -------------------------------------------------------------

export type VehicleReminder = {
  kind: VehicleReminderKind;
  /** What the reminder is about: the expiry, the estimated oil change, or the last reading. */
  dueAt: number;
  /** When the notification comes: a few days before (at 9:00), or the snoozed time. */
  at: number;
  /** For the oil change, the km it is due at. */
  dueKm?: number | null;
  /** The oil change date comes from the km estimate. */
  byKm?: boolean;
};

/** `days` before `day` at the reminder hour (local time). */
function noticeAt(day: number, days: number) {
  const date = new Date(day);
  date.setDate(date.getDate() - days);
  date.setHours(REMINDER_HOUR, 0, 0, 0);
  return date.getTime();
}

/**
 * The reminders this vehicle has: insurance and inspection (a few days before
 * their date), the estimated oil change, and an odometer update when there was
 * no reading for 30 days. Past dates are kept (the screen shows them as due);
 * a later snooze moves the notification. Soonest first.
 */
export function vehicleReminders(vehicle: Vehicle): VehicleReminder[] {
  const notice = vehicle.noticeDays ?? DEFAULT_NOTICE_DAYS;
  const reminders: VehicleReminder[] = [];
  const insurance = parseDay(vehicle.insuranceUntil);
  if (insurance !== null) reminders.push({ kind: "insurance", dueAt: insurance, at: noticeAt(insurance, notice) });
  const inspection = parseDay(vehicle.inspectionUntil);
  if (inspection !== null) reminders.push({ kind: "inspection", dueAt: inspection, at: noticeAt(inspection, notice) });
  const oil = oilChangeEstimate(vehicle);
  if (oil) reminders.push({ kind: "oilChange", dueAt: oil.dueAt, at: noticeAt(oil.dueAt, notice), dueKm: oil.dueKm, byKm: oil.byKm });
  const reading = latestReading(vehicle);
  if (reading) {
    const stale = reading.at + ODOMETER_STALE_DAYS * DAY;
    reminders.push({ kind: "odometer", dueAt: stale, at: noticeAt(stale, 0) });
  }
  return reminders
    .map((reminder) => {
      const snoozed = vehicle.snoozed?.[reminder.kind];
      return snoozed && snoozed > reminder.at ? { ...reminder, at: snoozed } : reminder;
    })
    .sort((a, b) => a.at - b.at);
}

/** The reminders whose time has come (shown on the screen, with "remind me later"). */
export function dueReminders(vehicle: Vehicle, now: number) {
  return vehicleReminders(vehicle).filter((reminder) => reminder.at <= now);
}

// ---- Expenses --------------------------------------------------------------

export const spendingKinds = ["fuel", "maintenance", "insurance", "other"] as const;
export type SpendingKind = (typeof spendingKinds)[number];

/** Every amount paid for the vehicle, with its kind and day. */
export function vehicleSpending(vehicle: Pick<Vehicle, "fuel" | "maintenance" | "expenses">) {
  return [
    ...vehicle.fuel.filter((fill) => fill.amountMga).map((fill) => ({ kind: "fuel" as SpendingKind, at: fill.at, amountMga: fill.amountMga! })),
    ...vehicle.maintenance.filter((entry) => entry.costMga).map((entry) => ({ kind: "maintenance" as SpendingKind, at: entry.at, amountMga: entry.costMga! })),
    ...vehicle.expenses.map((expense) => ({ kind: expense.kind as SpendingKind, at: expense.at, amountMga: expense.amountMga })),
  ];
}

type PeriodTotals = { total: number } & Record<SpendingKind, number>;

const emptyTotals = (): PeriodTotals => ({ total: 0, fuel: 0, maintenance: 0, insurance: 0, other: 0 });

/**
 * Spending this month, last month and over the last six months (this one
 * included), by kind; and month by month over those six, the oldest first.
 */
export function spendingByPeriod(vehicle: Pick<Vehicle, "fuel" | "maintenance" | "expenses">, now: number) {
  const current = new Date(startOfMonth(now));
  const monthStart = (back: number) => new Date(current.getFullYear(), current.getMonth() - back, 1).getTime();
  const thisMonth = monthStart(0);
  const lastMonth = monthStart(1);
  const sixMonths = monthStart(5);
  const nextMonth = new Date(current.getFullYear(), current.getMonth() + 1, 1).getTime();
  const periods = { thisMonth: emptyTotals(), lastMonth: emptyTotals(), sixMonths: emptyTotals() };
  const months = Array.from({ length: 6 }, (_, index) => ({ month: monthStart(5 - index), total: 0 }));

  for (const { kind, at, amountMga } of vehicleSpending(vehicle)) {
    if (at < sixMonths || at >= nextMonth) continue;
    const add = (totals: PeriodTotals) => {
      totals[kind] += amountMga;
      totals.total += amountMga;
    };
    add(periods.sixMonths);
    if (at >= thisMonth) add(periods.thisMonth);
    else if (at >= lastMonth) add(periods.lastMonth);
    const month = months.find((item) => item.month === startOfMonth(at));
    if (month) month.total += amountMga;
  }
  return { ...periods, months };
}

// ---- From a scan -----------------------------------------------------------

/** Plates compared without spaces, dashes or case: "1234 TBA" = "1234-tba". */
export const plateKey = (plate: string | undefined | null) => (plate ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();

/** The vehicle a registration certificate (or a vehicle scan) is most likely about. */
export function matchVehicle<T extends Pick<Vehicle, "plate" | "vin" | "scanIds">>(vehicles: T[], analysis: Pick<Analysis, "document">, scanId?: string) {
  if (scanId) {
    const linked = vehicles.find((vehicle) => vehicle.scanIds.includes(scanId));
    if (linked) return linked;
  }
  const read = analysis.document?.registration;
  if (!read) return null;
  return (
    (read.vin && vehicles.find((vehicle) => vehicle.vin && plateKey(vehicle.vin) === plateKey(read.vin))) ||
    (read.plate && vehicles.find((vehicle) => vehicle.plate && plateKey(vehicle.plate) === plateKey(read.plate))) ||
    null
  );
}

const yearOf = (day: string | null | undefined) => {
  const at = parseDay(day);
  return at === null ? undefined : new Date(at).getFullYear();
};

const guessKind = (text: string): VehicleKind => (/moto|scooter|motorbike|motorcycle|bike/i.test(text) ? "motorbike" : /voiture|berline|car|suv|4x4|pick-?up|citadine|break|monospace|sedan|hatch/i.test(text) ? "car" : "other");

/** What a scan says about a vehicle: from a vehicle scan, or a registration certificate. Only fields it knows. */
export function vehicleFieldsFrom(analysis: Pick<Analysis, "vehicle" | "document">): Partial<Vehicle> {
  const fields: Partial<Vehicle> = {};
  const seen = analysis.vehicle;
  if (seen) {
    Object.assign(fields, { make: seen.make, model: seen.model, kind: guessKind(seen.kind) });
    if (seen.generation) fields.generation = seen.generation;
    if (seen.maintenance.length > 0) {
      fields.advice = seen.maintenance;
      const oil = oilIntervalFrom(seen.maintenance);
      if (oil.km) fields.oilIntervalKm = oil.km;
      if (oil.months) fields.oilIntervalMonths = oil.months;
    }
  }
  const read = analysis.document?.registration;
  if (read) {
    if (read.make) fields.make = read.make;
    if (read.model) fields.model = read.model;
    if (read.plate) fields.plate = read.plate.trim();
    if (read.vin) fields.vin = read.vin.trim();
    if (read.energy) fields.energy = read.energy;
    if (read.fiscalPower) fields.fiscalPower = read.fiscalPower;
    if (read.firstRegistration && parseDay(read.firstRegistration) !== null) {
      fields.firstRegistration = read.firstRegistration;
      fields.year = yearOf(read.firstRegistration);
    }
  }
  return fields;
}

/** The name a new vehicle gets from what was read: "Toyota Corolla". */
export function defaultVehicleName(fields: Partial<Vehicle>, fallback: string) {
  return [fields.make, fields.model].filter(Boolean).join(" ").trim() || fields.plate || fallback;
}
