import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import type { ParcelInfo } from "@/lib/parcels";
import { deliveryNotifyAt, deliveryState, expectedDay, formatDay, madagascarDay } from "@/lib/parcelDelivery";
import {
  PARCEL_NOTIFICATION_PREFIX,
  plannedParcelReminders,
  reconcileParcelReminderState,
  type ParcelReminderDeps,
  type ScheduledParcelReminders,
} from "@/services/parcelReminders";
import type { Parcel } from "@/services/parcelStore";

const info = (patch: Partial<ParcelInfo> = {}): ParcelInfo => ({
  platform: null,
  orderNumber: null,
  trackingNumber: null,
  carrier: null,
  status: "in_transit",
  statusLabel: "En transit",
  lastEvent: null,
  items: [],
  total: null,
  seller: null,
  orderedAt: null,
  shippedAt: null,
  estimatedDelivery: "2026-10-20",
  destinationCity: null,
  shippingMode: null,
  ...patch,
});

const parcel = (id: string, patch: Partial<Parcel> = {}, infoPatch: Partial<ParcelInfo> = {}): Parcel => ({
  id,
  title: `Colis ${id}`,
  info: info(infoPatch),
  scanIds: [],
  timeline: [],
  createdAt: 0,
  updatedAt: 0,
  ...patch,
});

// 2026-10-20 at 08:00 in Madagascar is 05:00 UTC.
const MORNING_20 = Date.UTC(2026, 9, 20, 5);

describe("expected delivery day", () => {
  it("reads the day as written, the first of a range", () => {
    expect(expectedDay("2026-10-20")).toEqual({ year: 2026, month: 10, day: 20 });
    expect(expectedDay("20/10/2026")).toEqual({ year: 2026, month: 10, day: 20 });
    expect(expectedDay("2026/10/20")).toEqual({ year: 2026, month: 10, day: 20 });
    expect(expectedDay("2026-10-20 – 2026-10-25")).toEqual({ year: 2026, month: 10, day: 20 });
    expect(expectedDay("bientôt")).toBeNull();
    expect(expectedDay(null)).toBeNull();
  });

  it("tells today in Madagascar time (UTC+3)", () => {
    // 22:30 UTC on the 19th is already 01:30 on the 20th in Antananarivo.
    expect(madagascarDay(Date.UTC(2026, 9, 19, 22, 30))).toEqual({ year: 2026, month: 10, day: 20 });
    expect(madagascarDay(Date.UTC(2026, 9, 19, 20, 59))).toEqual({ year: 2026, month: 10, day: 19 });
  });

  it("is upcoming, today or late", () => {
    expect(deliveryState(parcel("a"), Date.UTC(2026, 9, 19, 12))?.when).toBe("upcoming");
    expect(deliveryState(parcel("a"), Date.UTC(2026, 9, 19, 21, 30))?.when).toBe("today");
    expect(deliveryState(parcel("a"), Date.UTC(2026, 9, 20, 20))?.when).toBe("today");
    expect(deliveryState(parcel("a"), Date.UTC(2026, 9, 20, 21, 30))?.when).toBe("late");
  });

  it("says nothing once received or without a day", () => {
    expect(deliveryState(parcel("a", { receivedAt: 1 }), MORNING_20)).toBeNull();
    expect(deliveryState(parcel("a", {}, { estimatedDelivery: null }), MORNING_20)).toBeNull();
  });

  it("keeps the day of a parcel delivered to the forwarder, not received yet (arrival in Madagascar)", () => {
    // The owner's case: sea freight, at the forwarder's since 10 Oct, expected on 30 Nov.
    expect(deliveryState(parcel("a", {}, { status: "delivered", estimatedDelivery: "2026-11-30" }), MORNING_20)).toMatchObject({ when: "upcoming" });
  });

  it("formats the day whatever the time zone", () => {
    expect(formatDay({ year: 2026, month: 10, day: 20 }, "fr")).toBe("mar. 20 oct.");
    expect(formatDay({ year: 2026, month: 10, day: 20 }, "fr", { weekday: false })).toBe("20 oct.");
    expect(formatDay({ year: 2026, month: 10, day: 20 }, "en")).toBe("Tue 20 Oct");
  });
});

describe("delivery notification time", () => {
  it("fires on the expected day at the chosen hour, Madagascar time", () => {
    const before = Date.UTC(2026, 9, 18);
    expect(deliveryNotifyAt(parcel("a"), 8, before)).toBe(MORNING_20);
    // Midnight in Madagascar is 21:00 UTC the day before.
    expect(deliveryNotifyAt(parcel("a"), 0, before)).toBe(Date.UTC(2026, 9, 19, 21));
    expect(deliveryNotifyAt(parcel("a"), 23, before)).toBe(Date.UTC(2026, 9, 20, 20));
  });

  it("does nothing once that moment has passed", () => {
    expect(deliveryNotifyAt(parcel("a"), 8, MORNING_20)).toBeNull();
    expect(deliveryNotifyAt(parcel("a"), 8, MORNING_20 + 1)).toBeNull();
    expect(deliveryNotifyAt(parcel("a"), 9, MORNING_20)).toBe(MORNING_20 + 3_600_000);
  });

  it("skips received or undated parcels, not those at the forwarder's", () => {
    const before = Date.UTC(2026, 9, 18);
    expect(deliveryNotifyAt(parcel("a", { receivedAt: 1 }), 8, before)).toBeNull();
    expect(deliveryNotifyAt(parcel("a", {}, { estimatedDelivery: null }), 8, before)).toBeNull();
    expect(deliveryNotifyAt(parcel("a", {}, { status: "delivered" }), 8, before)).not.toBeNull();
  });
});

describe("parcel reminders", () => {
  const now = Date.UTC(2026, 9, 18);
  const texts = (item: Parcel) => ({ title: "Arrive", body: item.title });

  const fakeDeps = (stored: ScheduledParcelReminders = {}, pending: Set<number> | null = null) => {
    let saved = stored;
    let nextId = 100;
    const deps = {
      permission: vi.fn(async () => "granted"),
      notify: vi.fn(async () => nextId++),
      cancel: vi.fn(async (id: number) => void id),
      pending: vi.fn(async () => pending),
      load: () => saved,
      save: (value: ScheduledParcelReminders) => {
        saved = value;
      },
    } satisfies ParcelReminderDeps;
    return { deps, saved: () => saved };
  };

  it("plans nothing when switched off", () => {
    expect(plannedParcelReminders([parcel("a")], { enabled: false, hour: 8 }, now).size).toBe(0);
    expect(plannedParcelReminders([parcel("a")], { enabled: true, hour: 8 }, now).get("a")?.at).toBe(MORNING_20);
  });

  it("schedules the missing ones, opening the parcels", async () => {
    const { deps, saved } = fakeDeps();
    await reconcileParcelReminderState([parcel("a"), parcel("b", { receivedAt: 1 })], { enabled: true, hour: 8 }, texts, deps, now);
    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(deps.notify).toHaveBeenCalledWith({ title: "Arrive", body: "Colis a", at: new Date(MORNING_20), entryId: `${PARCEL_NOTIFICATION_PREFIX}a` });
    expect(saved()).toEqual({ a: { id: 100, at: MORNING_20, title: "Colis a" } });
  });

  it("keeps what is still right and cancels the rest", async () => {
    const stored: ScheduledParcelReminders = {
      a: { id: 1, at: MORNING_20, title: "Colis a" },
      gone: { id: 2, at: MORNING_20, title: "Colis gone" },
      received: { id: 3, at: MORNING_20, title: "Colis received" },
    };
    const { deps, saved } = fakeDeps(stored);
    await reconcileParcelReminderState([parcel("a"), parcel("received", { receivedAt: 1 })], { enabled: true, hour: 8 }, texts, deps, now);
    expect(deps.notify).not.toHaveBeenCalled();
    expect(deps.cancel.mock.calls.map(([id]) => id)).toEqual([2, 3]);
    expect(saved()).toEqual({ a: stored.a });
  });

  it("moves it when the day or the hour changes", async () => {
    const { deps, saved } = fakeDeps({ a: { id: 1, at: MORNING_20, title: "Colis a" } });
    await reconcileParcelReminderState([parcel("a", {}, { estimatedDelivery: "2026-10-21" })], { enabled: true, hour: 9 }, texts, deps, now);
    expect(deps.cancel).toHaveBeenCalledWith(1);
    expect(saved().a).toEqual({ id: 100, at: Date.UTC(2026, 9, 21, 6), title: "Colis a" });
  });

  it("cancels everything when switched off", async () => {
    const { deps, saved } = fakeDeps({ a: { id: 1, at: MORNING_20, title: "Colis a" } });
    await reconcileParcelReminderState([parcel("a")], { enabled: false, hour: 8 }, texts, deps, now);
    expect(deps.cancel).toHaveBeenCalledWith(1);
    expect(deps.notify).not.toHaveBeenCalled();
    expect(saved()).toEqual({});
  });

  it("schedules again one the device lost", async () => {
    const { deps, saved } = fakeDeps({ a: { id: 1, at: MORNING_20, title: "Colis a" } }, new Set([42]));
    await reconcileParcelReminderState([parcel("a")], { enabled: true, hour: 8 }, texts, deps, now);
    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(saved().a.id).toBe(100);
  });

  it("does nothing without permission", async () => {
    const { deps } = fakeDeps({ a: { id: 1, at: MORNING_20, title: "Colis a" } });
    deps.permission.mockResolvedValue("prompt");
    await reconcileParcelReminderState([parcel("a")], { enabled: false, hour: 8 }, texts, deps, now);
    expect(deps.cancel).not.toHaveBeenCalled();
    expect(deps.notify).not.toHaveBeenCalled();
  });
});
