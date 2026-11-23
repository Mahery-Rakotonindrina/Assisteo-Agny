import { describe, expect, it } from "vitest";
import type { ParcelStatus } from "@/lib/ai/schema";
import {
  AUTO_TRACK_SCAN_ID,
  checkedAgo,
  eventAt,
  mergeTracking,
  needsCheck,
  parcelsToCheck,
  RECHECK_AFTER_MS,
  STALE_AFTER_MS,
  statusFrom17,
  trackedInfo,
  trackingKey,
  trackingSignature,
  type TrackedParcel,
} from "@/lib/parcelTracking";
import { demoTrackItem } from "@/lib/server/track17";
import fr from "@/locales/fr.json";

const labels = fr.parcel.statuses as Record<ParcelStatus, string>;
const NOW = new Date(2026, 10, 19, 12).getTime();
const HOUR = 3600_000;

const parcel = (fields: Partial<TrackedParcel> & { status?: ParcelStatus; number?: string | null; eventAtText?: string } = {}): TrackedParcel & Record<string, unknown> => {
  const { status = "shipped", number = "YT2412345678901", eventAtText = "2026-11-15 08:00", ...rest } = fields;
  return {
    id: "p1",
    title: "Chaussures",
    info: {
      platform: "Temu",
      orderNumber: null,
      trackingNumber: number,
      carrier: "YunExpress",
      status,
      statusLabel: labels[status],
      lastEvent: { description: "Colis pris en charge", location: "Shenzhen", at: eventAtText },
      items: [],
      total: null,
      seller: null,
      orderedAt: null,
      shippedAt: null,
      estimatedDelivery: null,
      destinationCity: null,
      shippingMode: null,
    },
    timeline: [{ at: NOW - 4 * 86_400_000, status, statusLabel: labels[status], event: null, scanId: "scan-1" }],
    createdAt: NOW - 5 * 86_400_000,
    ...rest,
  };
};

describe("17TRACK statuses as parcel statuses", () => {
  it("maps every main status, and the sub statuses that change the meaning", () => {
    expect(statusFrom17("InfoReceived")).toBe("shipped");
    expect(statusFrom17("InTransit", "InTransit_PickedUp")).toBe("shipped");
    expect(statusFrom17("InTransit", "InTransit_CustomsProcessing")).toBe("in_transit");
    expect(statusFrom17("AvailableForPickup")).toBe("pickup_ready");
    expect(statusFrom17("OutForDelivery")).toBe("out_for_delivery");
    expect(statusFrom17("Delivered", "Delivered_Other")).toBe("delivered");
    expect(statusFrom17("DeliveryFailure", "DeliveryFailure_NoBody")).toBe("exception");
    expect(statusFrom17("Exception", "Exception_Returned")).toBe("returned");
    expect(statusFrom17("Exception", "Exception_Returning")).toBe("returned");
    expect(statusFrom17("Exception", "Exception_Delayed")).toBe("in_transit");
    expect(statusFrom17("Exception", "Exception_Lost")).toBe("exception");
  });

  it("keeps nothing from a number not found yet, an expired tracking or an unknown status", () => {
    expect(statusFrom17("NotFound", "NotFound_Other")).toBeNull();
    expect(statusFrom17("Expired", "Expired_Other")).toBeNull();
    expect(statusFrom17("Teleported")).toBeNull();
    expect(statusFrom17(null)).toBeNull();
  });

  it("reads the event time as the carrier wrote it, else from the ISO time", () => {
    expect(eventAt({ time_raw: { date: "2026-11-18", time: "20:43:24" }, time_iso: "2026-11-18T20:43:24-06:00" })).toBe("2026-11-18 20:43");
    expect(eventAt({ time_raw: { date: "2026-11-18", time: null } })).toBe("2026-11-18");
    expect(eventAt({ time_iso: "2026-11-18T07:05:00+08:00" })).toBe("2026-11-18 07:05");
    expect(eventAt({ time_raw: null, time_iso: null })).toBeNull();
    expect(eventAt(null)).toBeNull();
  });

  it("turns an answer into the parcel's status, label and last event", () => {
    const item = {
      number: "YT1",
      track_info: {
        latest_status: { status: "InTransit", sub_status: "InTransit_Arrival" },
        latest_event: { time_raw: { date: "2026-11-18", time: "09:30:00" }, description: " Arrived at hub ", location: " Guangzhou " },
      },
    };
    expect(trackedInfo(item, labels)).toEqual({ status: "in_transit", statusLabel: "En transit", lastEvent: { description: "Arrived at hub", location: "Guangzhou", at: "2026-11-18 09:30" } });
    expect(trackedInfo({ number: "YT1", track_info: { latest_status: { status: "Delivered" }, latest_event: null } }, labels)).toEqual({ status: "delivered", statusLabel: "Livré", lastEvent: null });
    expect(trackedInfo({ number: "YT1", track_info: { latest_status: { status: "NotFound" } } }, labels)).toBeNull();
    expect(trackedInfo({ number: "YT1" }, labels)).toBeNull();
  });
});

describe("merging what 17TRACK says into a synced parcel", () => {
  const update = { status: "in_transit" as const, statusLabel: "En transit", lastEvent: { description: "Arrived at hub", location: "Guangzhou", at: "2026-11-18 09:30" } };

  it("changes only the tracking fields, and adds the step to the timeline", () => {
    const before = { ...parcel(), priceMga: 45000, client: "Rado", fees: [{ id: "f", label: "Fret", amountMga: 9000 }], title: "Baskets Rado" };
    const { parcel: after, changed } = mergeTracking(before, update, NOW);
    expect(changed).toBe(true);
    expect(after.info).toEqual({ ...before.info, status: "in_transit", statusLabel: "En transit", lastEvent: update.lastEvent });
    expect(after.timeline).toHaveLength(2);
    expect(after.timeline[1]).toEqual({ at: NOW, status: "in_transit", statusLabel: "En transit", event: update.lastEvent, scanId: AUTO_TRACK_SCAN_ID });
    expect(after.autoTrack).toEqual({ checkedAt: NOW, number: "YT2412345678901" });
    const { info: _a, timeline: _b, autoTrack: _c, ...rest } = after;
    const { info: _d, timeline: _e, ...restBefore } = before;
    expect(rest).toEqual(restBefore);
  });

  it("only notes the check when nothing moved, or when the parcel's own news is fresher", () => {
    const same = parcel({ status: "in_transit", eventAtText: "2026-11-18 09:30" });
    same.info.lastEvent = update.lastEvent;
    const unchanged = mergeTracking(same, update, NOW);
    expect(unchanged.changed).toBe(false);
    expect(unchanged.parcel.info).toBe(same.info);
    expect(unchanged.parcel.timeline).toBe(same.timeline);
    expect(unchanged.parcel.autoTrack?.checkedAt).toBe(NOW);

    // A screenshot taken after 17TRACK's last event (out for delivery): 17TRACK's older news is not applied.
    const fresher = parcel({ status: "out_for_delivery", eventAtText: "2026-11-19 08:00" });
    expect(mergeTracking(fresher, update, NOW).changed).toBe(false);
  });

  it("applies a problem at any step, and a later step without any date", () => {
    const shipped = parcel({ status: "in_transit" });
    shipped.info.lastEvent = null;
    expect(mergeTracking(shipped, { status: "exception", statusLabel: labels.exception, lastEvent: null }, NOW).changed).toBe(true);
    expect(mergeTracking(shipped, { status: "pickup_ready", statusLabel: labels.pickup_ready, lastEvent: null }, NOW).changed).toBe(true);
    // A step back without a date: not news.
    expect(mergeTracking(shipped, { status: "shipped", statusLabel: labels.shipped, lastEvent: null }, NOW).changed).toBe(false);
  });

  it("keeps the parcel's own last event when 17TRACK gives none, and notes a check with nothing found", () => {
    const before = parcel();
    const { parcel: after } = mergeTracking(before, { status: "in_transit", statusLabel: "En transit", lastEvent: null }, NOW);
    expect(after.info.lastEvent).toEqual(before.info.lastEvent);
    const nothing = mergeTracking(before, null, NOW);
    expect(nothing.changed).toBe(false);
    expect(nothing.parcel.info).toBe(before.info);
    expect(nothing.parcel.autoTrack).toEqual({ checkedAt: NOW, number: "YT2412345678901" });
  });

  it("marks a number 17TRACK refused, and forgets it with a real answer", () => {
    const refused = mergeTracking(parcel(), null, NOW, { refused: true });
    expect(refused.changed).toBe(false);
    expect(refused.parcel.info).toEqual(parcel().info);
    expect(refused.parcel.autoTrack).toEqual({ checkedAt: NOW, number: "YT2412345678901", refused: true });
    // Even with an answer in hand, a refused number changes nothing.
    expect(mergeTracking(parcel(), update, NOW, { refused: true }).parcel.info.status).toBe("shipped");
    const later = NOW + 4 * HOUR;
    expect(mergeTracking(refused.parcel, update, later).parcel.autoTrack).toEqual({ checkedAt: later, number: "YT2412345678901" });
    expect(mergeTracking(refused.parcel, null, later).parcel.autoTrack).toEqual({ checkedAt: later, number: "YT2412345678901" });
  });

  it("signs a status by its step and event, to notify it once", () => {
    expect(trackingSignature(update)).toBe("in_transit|2026-11-18 09:30|Arrived at hub");
    expect(trackingSignature({ status: "delivered", lastEvent: null })).toBe("delivered||");
  });
});

describe("choosing the parcels to ask about", () => {
  it("normalises tracking numbers and refuses what 17TRACK can't take", () => {
    expect(trackingKey(" yt24 1234.5678 ")).toBe("YT2412345678");
    expect(trackingKey("LP-0042-CN")).toBe("LP-0042-CN");
    expect(trackingKey("1234")).toBeNull();
    expect(trackingKey("申通1234567")).toBeNull();
    expect(trackingKey(null)).toBeNull();
  });

  it("leaves out parcels arrived, returned, in hand, removed, without a number, or still for a long time", () => {
    expect(needsCheck(parcel(), NOW)).toBe(true);
    expect(needsCheck(parcel({ status: "delivered" }), NOW)).toBe(false);
    expect(needsCheck(parcel({ status: "returned" }), NOW)).toBe(false);
    expect(needsCheck(parcel({ receivedAt: NOW - HOUR }), NOW)).toBe(false);
    expect(needsCheck(parcel({ deletedAt: NOW - HOUR }), NOW)).toBe(false);
    expect(needsCheck(parcel({ number: null }), NOW)).toBe(false);
    const still = parcel({ eventAtText: "2026-01-02 10:00", createdAt: NOW - STALE_AFTER_MS - 86_400_000 });
    still.timeline = [{ ...still.timeline[0], at: NOW - STALE_AFTER_MS - HOUR }];
    expect(needsCheck(still, NOW)).toBe(false);
    // A recent scan of an old parcel counts as movement.
    still.timeline.push({ ...still.timeline[0], at: NOW - 86_400_000 });
    expect(needsCheck(still, NOW)).toBe(true);
  });

  it("asks again only after the pause between two runs", () => {
    expect(needsCheck(parcel({ autoTrack: { checkedAt: NOW - HOUR, number: "YT2412345678901" } }), NOW)).toBe(false);
    expect(needsCheck(parcel({ autoTrack: { checkedAt: NOW - RECHECK_AFTER_MS, number: "YT2412345678901" } }), NOW)).toBe(true);
  });

  it("takes the least recently checked first, within a number of distinct tracking numbers", () => {
    const row = (id: string, number: string, checkedAt?: number) => ({ id, parcel: parcel({ id, number, ...(checkedAt !== undefined && { autoTrack: { checkedAt, number } }) }) });
    const rows = [row("a", "AAAAA1", NOW - 5 * HOUR), row("b", "BBBBB2"), row("c", "CCCCC3", NOW - 9 * HOUR), row("d", "BBBBB2", NOW - 3 * HOUR), row("e", "DDDDD4", NOW - HOUR)];
    expect(parcelsToCheck(rows, NOW, 10).map((item) => item.id)).toEqual(["b", "c", "a", "d"]);
    // Two numbers: the parcel sharing B's number still comes along.
    expect(parcelsToCheck(rows, NOW, 2).map((item) => item.id)).toEqual(["b", "c", "d"]);
  });
});

describe("the line on the parcel", () => {
  it("says how long ago it was checked, in the largest whole unit", () => {
    expect(checkedAgo(NOW - 20_000, NOW)).toEqual({ unit: "now", count: 0 });
    expect(checkedAgo(NOW + 60_000, NOW)).toEqual({ unit: "now", count: 0 });
    expect(checkedAgo(NOW - 25 * 60_000, NOW)).toEqual({ unit: "minutes", count: 25 });
    expect(checkedAgo(NOW - 2 * HOUR - 50 * 60_000, NOW)).toEqual({ unit: "hours", count: 2 });
    expect(checkedAgo(NOW - 50 * HOUR, NOW)).toEqual({ unit: "days", count: 2 });
  });
});

describe("demo answers", () => {
  it("make up a status by the number's last digit, readable by trackedInfo", () => {
    expect(trackedInfo(demoTrackItem("DEMO0000000", NOW), labels)).toBeNull();
    expect(trackedInfo(demoTrackItem("DEMO0000009", NOW), labels)?.status).toBe("delivered");
    expect(trackedInfo(demoTrackItem("DEMO0000008", NOW), labels)?.status).toBe("exception");
    const transit = trackedInfo(demoTrackItem("DEMO0000001", NOW), labels);
    expect(transit?.status).toBe("in_transit");
    expect(transit?.lastEvent?.at).toBe("2026-11-19 08:00");
    expect(trackedInfo(demoTrackItem("DEMO0000001", new Date(2026, 10, 19, 6).getTime()), labels)?.lastEvent?.at).toBe("2026-11-18 08:00");
  });
});
