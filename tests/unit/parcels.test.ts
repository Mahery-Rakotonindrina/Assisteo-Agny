import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { mockAnalysis } from "@/lib/ai/mock";
import { isNewerParcel, sameParcel, type ParcelInfo } from "@/lib/parcels";
import { historyStore } from "@/services/historyStore";
import { updateEarlierParcelScans } from "@/services/parcelLinking";
import { hasNewStatus, parcelStore } from "@/services/parcelStore";
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
    expect(updated.receivedAt).toBeTypeOf("number");
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
});
