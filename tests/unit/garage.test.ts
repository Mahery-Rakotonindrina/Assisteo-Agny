import "fake-indexeddb/auto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockAnalysis } from "@/lib/ai/mock";
import { AnalysisSchema, normalizeStoredAnalysis } from "@/lib/ai/schema";
import {
  dueReminders,
  fuelConsumption,
  kmPerDay,
  matchVehicle,
  oilChangeEstimate,
  oilIntervalFrom,
  REMINDER_HOUR,
  spendingByPeriod,
  vehicleFieldsFrom,
  vehicleReminders,
  type FuelEntry,
  type Vehicle,
} from "@/lib/garage";
import { hasFeature, planFor } from "@/lib/plans";
import { tapTarget } from "@/services/notificationTap";
import {
  plannedVehicleReminders,
  reconcileVehicleReminderState,
  VEHICLE_NOTIFICATION_PREFIX,
  type ScheduledVehicleReminders,
  type VehicleReminderDeps,
} from "@/services/vehicleReminders";
import { vehicleStore } from "@/services/vehicleStore";
import type { HistoryEntry } from "@/types/history";
import { RESTORE_KEYS } from "@/scripts/lib/backup.mjs";

const DAY = 86_400_000;
// Local dates: the reminders follow the phone's clock.
const day = (year: number, month: number, date: number, hour = 0) => new Date(year, month - 1, date, hour).getTime();

const vehicle = (patch: Partial<Vehicle> = {}): Vehicle => ({
  id: "v1",
  name: "La Corolla",
  kind: "car",
  scanIds: [],
  noticeDays: 5,
  odometer: [],
  maintenance: [],
  fuel: [],
  expenses: [],
  createdAt: 0,
  updatedAt: 0,
  ...patch,
});

const fill = (id: string, km: number, litres: number, full = true, amountMga?: number): FuelEntry => ({ id, at: day(2026, 10, 1) + km, km, litres, full, amountMga });

describe("fuel consumption", () => {
  it("needs two full fills", () => {
    expect(fuelConsumption([]).average).toBeNull();
    expect(fuelConsumption([fill("a", 1000, 40)]).last).toBeNull();
  });

  it("is measured between full fills, partial ones included", () => {
    // 500 km on 30 + 10 litres, then 400 km on 30 litres.
    const fills = [fill("a", 1000, 40), fill("b", 1300, 10, false), fill("c", 1500, 30), fill("d", 1900, 30)];
    const result = fuelConsumption(fills);
    expect(result.last).toBeCloseTo(7.5);
    expect(result.average).toBeCloseTo((70 / 900) * 100);
    expect(result.km).toBe(900);
  });

  it("gives the cost per km only over stretches where every fill has an amount", () => {
    const fills = [fill("a", 1000, 40, true, 200_000), fill("b", 1500, 40, true, 200_000), fill("c", 2000, 40, true)];
    expect(fuelConsumption(fills).costPerKm).toBe(400);
  });
});

describe("km per day and the oil change", () => {
  const readings = { odometer: [{ at: day(2026, 9, 1), km: 40_000 }, { at: day(2026, 10, 1), km: 41_500 }] };

  it("averages the readings", () => {
    expect(kmPerDay(vehicle(readings))).toBeCloseTo(50);
    expect(kmPerDay(vehicle({ odometer: [{ at: day(2026, 10, 1), km: 41_500 }] }))).toBeNull();
  });

  it("estimates the day the km interval is reached", () => {
    const car = vehicle({ ...readings, oilIntervalKm: 4000, maintenance: [{ id: "m", at: day(2026, 9, 1), kind: "oil", km: 40_000 }] });
    // Due at 44 000 km: 2 500 km after the last reading, 50 days at 50 km a day.
    const estimate = oilChangeEstimate(car)!;
    expect(estimate.dueKm).toBe(44_000);
    expect(estimate.byKm).toBe(true);
    expect(estimate.dueAt).toBe(day(2026, 10, 1) + 50 * DAY);
  });

  it("falls back on the months, which win when they come first", () => {
    const car = vehicle({ ...readings, oilIntervalKm: 5000, oilIntervalMonths: 1, maintenance: [{ id: "m", at: day(2026, 8, 31), kind: "oil", km: 39_000 }] });
    expect(oilChangeEstimate(car)).toEqual({ dueKm: 44_000, dueAt: day(2026, 9, 30), byKm: false });
    expect(oilChangeEstimate(vehicle({ oilIntervalKm: 5000 }))).toBeNull();
  });

  it("is due now when the odometer is past it", () => {
    const car = vehicle({ ...readings, oilIntervalKm: 1000, maintenance: [{ id: "m", at: day(2026, 8, 1), kind: "oil", km: 39_000 }] });
    expect(oilChangeEstimate(car)?.dueAt).toBe(day(2026, 10, 1));
  });

  it("reads the interval on a vehicle scan's advice", () => {
    expect(oilIntervalFrom([{ task: "Vidange moteur", interval: "15 000 km ou 1 an" }])).toEqual({ km: 15_000, months: 12 });
    expect(oilIntervalFrom([{ task: "Oil change", interval: "every 10,000 km or 6 months" }])).toEqual({ km: 10_000, months: 6 });
    expect(oilIntervalFrom([{ task: "Brake fluid", interval: "2 years" }])).toEqual({});
  });
});

describe("vehicle reminders", () => {
  it("come a few days before the insurance and the inspection, at 9:00", () => {
    const reminders = vehicleReminders(vehicle({ insuranceUntil: "2026-11-10", inspectionUntil: "2026-12-01", noticeDays: 3 }));
    expect(reminders.map((reminder) => reminder.kind)).toEqual(["insurance", "inspection"]);
    expect(reminders[0].at).toBe(day(2026, 11, 7, REMINDER_HOUR));
    expect(reminders[0].dueAt).toBe(day(2026, 11, 10));
  });

  it("ask for the odometer 30 days after the last reading", () => {
    const [reminder] = vehicleReminders(vehicle({ odometer: [{ at: day(2026, 10, 1, 15), km: 1000 }] }));
    expect(reminder.kind).toBe("odometer");
    expect(reminder.at).toBe(day(2026, 10, 31, REMINDER_HOUR));
  });

  it("move to the snoozed time, and are due once their time has come", () => {
    const car = vehicle({ insuranceUntil: "2026-11-10", snoozed: { insurance: day(2026, 11, 6, 10) } });
    expect(vehicleReminders(car)[0].at).toBe(day(2026, 11, 6, 10));
    expect(dueReminders(car, day(2026, 11, 6, 9))).toHaveLength(0);
    expect(dueReminders(car, day(2026, 11, 6, 11))).toHaveLength(1);
  });
});

describe("vehicle reminder notifications", () => {
  const now = day(2026, 10, 27, 12);
  const texts = (car: Vehicle, reminder: { kind: string }) => ({ title: reminder.kind, body: `${car.name} ${reminder.kind}` });
  const insured = vehicle({ insuranceUntil: "2026-11-10" });
  const INSURANCE_AT = day(2026, 11, 5, REMINDER_HOUR);

  const fakeDeps = (stored: ScheduledVehicleReminders = {}) => {
    let saved = stored;
    let nextId = 100;
    const deps = {
      permission: vi.fn(async () => "granted"),
      notify: vi.fn(async () => nextId++),
      cancel: vi.fn(async (id: number) => void id),
      pending: vi.fn(async () => null),
      load: () => saved,
      save: (value: ScheduledVehicleReminders) => {
        saved = value;
      },
    } satisfies VehicleReminderDeps;
    return { deps, saved: () => saved };
  };

  it("plans only what is still to come", () => {
    const planned = plannedVehicleReminders([vehicle({ insuranceUntil: "2026-10-20" }), insured], now);
    expect([...planned.keys()]).toEqual(["v1:insurance"]);
    expect(planned.get("v1:insurance")?.reminder.at).toBe(INSURANCE_AT);
  });

  it("schedules the missing ones, opening the vehicle", async () => {
    const { deps, saved } = fakeDeps();
    await reconcileVehicleReminderState([insured], texts, deps, { now });
    expect(deps.notify).toHaveBeenCalledWith({ title: "insurance", body: "La Corolla insurance", at: new Date(INSURANCE_AT), entryId: `${VEHICLE_NOTIFICATION_PREFIX}v1` });
    expect(saved()).toEqual({ "v1:insurance": { id: 100, at: INSURANCE_AT, text: "La Corolla insurance" } });
    expect(tapTarget(`${VEHICLE_NOTIFICATION_PREFIX}v1`)).toEqual({ pathname: "/garage", query: { open: "v1" } });
  });

  it("keeps what is still right, moves what changed, cancels the rest", async () => {
    const stored: ScheduledVehicleReminders = {
      "v1:insurance": { id: 1, at: INSURANCE_AT, text: "La Corolla insurance" },
      "v1:inspection": { id: 2, at: INSURANCE_AT, text: "La Corolla inspection" },
      "gone:insurance": { id: 3, at: INSURANCE_AT, text: "x" },
    };
    const { deps, saved } = fakeDeps(stored);
    await reconcileVehicleReminderState([vehicle({ insuranceUntil: "2026-11-10", inspectionUntil: "2026-12-01" })], texts, deps, { now });
    expect(deps.cancel.mock.calls.map(([id]) => id)).toEqual([2, 3]);
    expect(saved()["v1:insurance"]).toEqual(stored["v1:insurance"]);
    expect(saved()["v1:inspection"]).toEqual({ id: 100, at: day(2026, 11, 26, REMINDER_HOUR), text: "La Corolla inspection" });
  });

  it("are cancelled below Premium, and come back with it", async () => {
    const { deps, saved } = fakeDeps({ "v1:insurance": { id: 1, at: INSURANCE_AT, text: "La Corolla insurance" } });
    await reconcileVehicleReminderState([insured], texts, deps, { enabled: false, now });
    expect(deps.cancel).toHaveBeenCalledWith(1);
    expect(deps.notify).not.toHaveBeenCalled();
    expect(saved()).toEqual({});
    expect(plannedVehicleReminders([insured], now, false).size).toBe(0);

    await reconcileVehicleReminderState([insured], texts, deps, { enabled: true, now });
    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(saved()["v1:insurance"]).toEqual({ id: 100, at: INSURANCE_AT, text: "La Corolla insurance" });
  });

  it("does nothing without the permission", async () => {
    const { deps } = fakeDeps();
    deps.permission.mockResolvedValue("denied");
    await reconcileVehicleReminderState([insured], texts, deps, { now });
    expect(deps.notify).not.toHaveBeenCalled();
  });
});

describe("spending by period", () => {
  it("adds fuel, service and other expenses this month, last month and over six months", () => {
    const now = day(2026, 10, 15);
    const car = vehicle({
      fuel: [{ id: "f", at: day(2026, 10, 2), km: 1000, litres: 30, full: true, amountMga: 150_000 }],
      maintenance: [
        { id: "m", at: day(2026, 9, 20), kind: "oil", costMga: 80_000 },
        { id: "old", at: day(2026, 3, 20), kind: "tyres", costMga: 500_000 },
      ],
      expenses: [{ id: "e", at: day(2026, 5, 3), kind: "insurance", amountMga: 300_000 }],
    });
    const spending = spendingByPeriod(car, now);
    expect(spending.thisMonth).toMatchObject({ total: 150_000, fuel: 150_000 });
    expect(spending.lastMonth).toMatchObject({ total: 80_000, maintenance: 80_000 });
    expect(spending.sixMonths).toMatchObject({ total: 530_000, insurance: 300_000 });
    expect(spending.months.map((month) => month.total)).toEqual([300_000, 0, 0, 0, 80_000, 150_000]);
  });
});

describe("registration certificate", () => {
  const registration = mockAnalysis("auto", "fr");
  // The demo cycles through its examples: the registration certificate is the 7th.
  const scan = Array.from({ length: 13 }, () => mockAnalysis("auto", "fr")).find((analysis) => analysis.document?.registration) ?? registration;

  it("has a demo version that validates", () => {
    expect(scan.document?.registration?.plate).toBe("1234 TBA");
    expect(AnalysisSchema.safeParse(scan).success).toBe(true);
  });

  it("defaults to none on older scans", () => {
    const old = { ...mockAnalysis("document", "fr"), document: { ...mockAnalysis("document", "fr").document } };
    delete (old.document as Record<string, unknown>).registration;
    expect((normalizeStoredAnalysis(old) as typeof old).document?.registration).toBeNull();
  });

  it("fills a vehicle in, and finds the one it is about", () => {
    expect(vehicleFieldsFrom(scan)).toMatchObject({ make: "Toyota", model: "Corolla", plate: "1234 TBA", energy: "petrol", fiscalPower: 7, year: 2019 });
    expect(matchVehicle([vehicle({ plate: "1234-tba" })], scan)?.id).toBe("v1");
    expect(matchVehicle([vehicle({ plate: "9999 TBB" })], scan)).toBeNull();
  });

  it("a vehicle scan gives the oil change interval", () => {
    expect(vehicleFieldsFrom(mockAnalysis("vehicle", "fr"))).toMatchObject({ make: "Toyota", kind: "car", oilIntervalKm: 15_000, oilIntervalMonths: 12 });
  });
});

describe("vehicle store", () => {
  beforeEach(() => vehicleStore.wipe());

  it("adds a vehicle from a scan once, then updates it", async () => {
    const entry = { id: "scan-1", createdAt: 0, analysis: mockAnalysis("vehicle", "fr") } as HistoryEntry;
    const created = await vehicleStore.addFromScan(entry, "Mon véhicule");
    expect(created).toMatchObject({ name: "Toyota Corolla Hybride", scanIds: ["scan-1"], oilIntervalKm: 15_000 });
    await vehicleStore.saveFuel(created.id, { at: 1, km: 1000, litres: 40, full: true });
    await vehicleStore.saveFuel(created.id, { at: 2, km: 1500, litres: 35, full: true });
    const saved = await vehicleStore.get(created.id);
    expect(fuelConsumption(saved!.fuel).last).toBeCloseTo(7);
    expect(saved?.dirty).toBe(true);
  });
});

describe("plan and backups", () => {
  it("is a Premium feature", () => {
    expect(planFor("garage")).toBe("premium");
    expect(hasFeature("lite", "garage")).toBe(false);
    expect(hasFeature("premium", "garage")).toBe(true);
  });

  it("backs up every table the migrations create", () => {
    expect(RESTORE_KEYS.vehicles).toEqual(["user_id", "id"]);
    const dir = join(process.cwd(), "supabase", "migrations");
    const created = readdirSync(dir)
      .flatMap((file) => [...readFileSync(join(dir, file), "utf8").matchAll(/create table if not exists public\.(\w+)/g)].map((match) => match[1]))
      .filter((table) => table !== "_migrations");
    for (const table of created) expect(RESTORE_KEYS).toHaveProperty(table);
  });
});
