import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { mockAnalysis } from "@/lib/ai/mock";
import { compareParcels, isNewerParcel, sameParcel, type ParcelInfo } from "@/lib/parcels";
import { historyStore } from "@/services/historyStore";
import { keepParcelThumbnails, updateEarlierParcelScans } from "@/services/parcelLinking";
import { hasNewStatus, parcelStore, parcelTotalMga } from "@/services/parcelStore";
import type { HistoryEntry } from "@/types/history";

// The demo parcel: in transit, last event 2026-10-07 17:21.
const base = mockAnalysis("auto", "fr");
const demoParcel = (() => {
  for (let i = 0; i < 5; i++) {
    const analysis = mockAnalysis("auto", "fr");
    if (analysis.parcel) return analysis;
  }
  throw new Error("no demo parcel");
})();
const info = (patch: Partial<ParcelInfo> = {}): ParcelInfo => ({ ...demoParcel.parcel!, ...patch });
const delivered = info({ status: "delivered", statusLabel: "Livré", lastEvent: { description: "Livré", location: "Foshan", at: "2026-10-09 10:12" } });

function scan(id: string, parcel: ParcelInfo, createdAt: number): HistoryEntry {
  return { id, createdAt, mode: "auto", thumbnail: "data:image/jpeg;base64,AA", preview: "data:image/jpeg;base64,AA", analysis: { ...demoParcel, parcel }, meta: { model: "demo", demo: true, durationMs: 1 } };
}

describe("parcel matching", () => {
  it("matches by tracking number, ignoring spaces, or by order number", () => {
    expect(sameParcel(info(), info({ trackingNumber: "7700 0000 0000 001" }))).toBe(true);
    expect(sameParcel(info(), info({ trackingNumber: null }))).toBe(true);
    expect(sameParcel(info(), info({ trackingNumber: "999", orderNumber: "other" }))).toBe(false);
    expect(sameParcel(base.parcel, info())).toBe(false);
  });

  it("only treats later states as news", () => {
    expect(isNewerParcel(info(), delivered)).toBe(true);
    expect(isNewerParcel(delivered, info())).toBe(false);
    expect(isNewerParcel(info(), info())).toBe(false);
    // Without event times, the progress step decides; a problem always counts.
    expect(isNewerParcel(info({ lastEvent: null }), info({ lastEvent: null, status: "out_for_delivery" }))).toBe(true);
    expect(isNewerParcel(info({ lastEvent: null }), info({ lastEvent: null, status: "exception" }))).toBe(true);
  });
});

describe("following a parcel", () => {
  beforeEach(async () => {
    await historyStore.wipe();
    await parcelStore.wipe();
  });

  it("adds once, then records a newer scan in its timeline", async () => {
    const first = scan("s1", info(), 1000);
    const parcel = await parcelStore.add(first);
    expect(await parcelStore.add(first)).toMatchObject({ id: parcel.id });
    expect(await parcelStore.list()).toHaveLength(1);

    const second = scan("s2", delivered, 2000);
    expect(hasNewStatus(parcel, delivered)).toBe(true);
    const updated = await parcelStore.applyScan(parcel, second);
    expect(updated.info.status).toBe("delivered");
    expect(updated.scanIds).toEqual(["s1", "s2"]);
    expect(updated.timeline.map((item) => item.status)).toEqual(["in_transit", "delivered"]);
    // Delivered by the carrier is not received: only the user says so.
    expect(updated.receivedAt).toBeUndefined();
    // Details missing from the new screenshot are kept.
    const sparse = await parcelStore.applyScan(updated, scan("s3", { ...delivered, total: null, items: [] }, 3000));
    expect(sparse.info.total).toBe(demoParcel.parcel!.total);
    expect(sparse.info.items).toHaveLength(1);
  });

  it("updates earlier scans of the same parcel, never with an older state", async () => {
    await historyStore.rawPut(scan("old", info(), 1000));
    await historyStore.rawPut(scan("other", { ...info(), trackingNumber: "123", orderNumber: "456" }, 1500));
    const newer = scan("new", delivered, 2000);
    await historyStore.rawPut(newer);

    const updated = await updateEarlierParcelScans(newer);
    expect(updated.map((entry) => entry.id)).toEqual(["old"]);
    expect((await historyStore.get("old"))?.analysis.parcel?.status).toBe("delivered");
    expect((await historyStore.get("other"))?.analysis.parcel?.status).toBe("in_transit");

    // Re-scanning the old screenshot doesn't roll the status back.
    expect(await updateEarlierParcelScans(scan("again", info(), 3000))).toEqual([]);
  });

  it("keeps its own photo, so it stays recognisable once the scans are deleted", async () => {
    await parcelStore.wipe();
    await historyStore.clear();
    const first = scan("photo-1", info(), 1000);
    await historyStore.rawPut(first);
    const parcel = await parcelStore.add(first);
    expect(parcel.thumbnail).toBe(first.thumbnail);

    // A parcel followed before parcels kept a photo catches up from its scans.
    await parcelStore.rawPut({ ...parcel, thumbnail: undefined });
    await keepParcelThumbnails(["photo-1"]);
    await historyStore.clear();
    expect((await parcelStore.list())[0].thumbnail).toBe(first.thumbnail);
  });
});

describe("parcel costs", () => {
  beforeEach(async () => {
    await parcelStore.wipe();
  });

  it("adds the price and every fee, in ariary", async () => {
    expect(parcelTotalMga({})).toBe(0);
    const parcel = await parcelStore.add(scan("c1", info(), 1000));
    await parcelStore.setCosts(parcel.id, {
      priceMga: 120000,
      fees: [
        { id: "f1", label: "Fret", amountMga: 45000 },
        { id: "f2", label: "Douane", amountMga: 30000 },
      ],
    });
    const [saved] = await parcelStore.list();
    expect(parcelTotalMga(saved)).toBe(195000);
    expect(saved.dirty).toBe(true);
  });

  it("keeps received and not received under the user's control", async () => {
    const parcel = await parcelStore.add(scan("r1", delivered, 1000));
    expect(parcel.receivedAt).toBeUndefined();
    await parcelStore.markReceived(parcel, true);
    const [received] = await parcelStore.list();
    expect(received.receivedAt).toBeTypeOf("number");
    await parcelStore.markReceived(received, false);
    expect((await parcelStore.list())[0].receivedAt).toBeUndefined();
  });

  it("lets the pick-up date be corrected, cleared, or left alone", async () => {
    const parcel = await parcelStore.add(scan("d1", delivered, 1000));
    await parcelStore.markReceived(parcel, true);
    const pickedUp = new Date(2026, 9, 5, 12).getTime();
    await parcelStore.edit(parcel.id, { title: parcel.title, info: parcel.info, receivedAt: pickedUp });
    expect((await parcelStore.list())[0].receivedAt).toBe(pickedUp);
    await parcelStore.edit(parcel.id, { title: "Casque", info: parcel.info });
    expect((await parcelStore.list())[0].receivedAt).toBe(pickedUp);
    await parcelStore.edit(parcel.id, { title: "Casque", info: parcel.info, receivedAt: null });
    expect((await parcelStore.list())[0].receivedAt).toBeUndefined();
  });
});

describe("parcel list order", () => {
  const row = (id: string, status: ParcelInfo["status"], at: string | null, receivedAt?: number) => ({
    id,
    info: info({ status, lastEvent: at ? { description: status, location: null, at } : null }),
    timeline: [{ at: 1000 }],
    createdAt: 1000,
    receivedAt,
  });

  it("puts problems first, then follows the journey, delivered last, then received", () => {
    const rows = [
      row("received-old", "delivered", "2026-09-01 10:00", 1_000),
      row("delivered", "delivered", "2026-10-09 10:00"),
      row("transit-old", "in_transit", "2026-10-01 08:00"),
      row("ordered", "ordered", null),
      row("received-new", "delivered", "2026-09-20 10:00", 2_000),
      row("transit-new", "in_transit", "2026-10-07 08:00"),
      row("problem", "exception", "2026-10-02 08:00"),
      row("pickup", "pickup_ready", "2026-10-03 08:00"),
      row("shipped", "shipped", "2026-10-04 08:00"),
    ];
    expect(rows.sort(compareParcels).map((parcel) => parcel.id)).toEqual([
      "problem",
      "ordered",
      "shipped",
      "transit-new",
      "transit-old",
      "pickup",
      "delivered",
      "received-new",
      "received-old",
    ]);
  });
});
