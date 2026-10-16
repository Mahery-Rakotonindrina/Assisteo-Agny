import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { mockAnalysis } from "@/lib/ai/mock";
import { parcelStore } from "@/services/parcelStore";
import type { HistoryEntry } from "@/types/history";

const demo = (() => {
  for (let i = 0; i < 6; i++) {
    const analysis = mockAnalysis("auto", "fr");
    if (analysis.parcel) return analysis;
  }
  throw new Error("no demo parcel");
})();
const scan = (id: string, createdAt: number): HistoryEntry => ({
  id,
  createdAt,
  mode: "auto",
  thumbnail: "data:image/jpeg;base64,AA",
  preview: "data:image/jpeg;base64,AA",
  analysis: demo,
  meta: { model: "demo", demo: true, durationMs: 1 },
});

describe("a deleted parcel", () => {
  it("can be followed again from a new scan, signed in (tombstones kept)", async () => {
    await parcelStore.wipe();
    parcelStore.setKeepTombstones(true);
    const first = await parcelStore.add(scan("s1", 1000));
    await parcelStore.remove(first.id);
    expect(await parcelStore.list()).toHaveLength(0);
    const again = await parcelStore.add(scan("s2", 2000));
    expect(again.id).not.toBe(first.id);
    expect((await parcelStore.list()).map((parcel) => parcel.id)).toEqual([again.id]);
    expect(await parcelStore.findFor(demo.parcel)).toMatchObject({ id: again.id });
  });

  it("is not taken for another order shipped under the same tracking number (the owner's case)", async () => {
    await parcelStore.wipe();
    parcelStore.setKeepTombstones(true);
    const withInfo = (id: string, createdAt: number, parcel: Partial<NonNullable<HistoryEntry["analysis"]["parcel"]>>): HistoryEntry => ({
      ...scan(id, createdAt),
      analysis: { ...demo, parcel: { ...demo.parcel!, ...parcel } },
    });
    // Order A, followed, with tracking JT…; order B followed before its tracking existed, then removed.
    const orderA = await parcelStore.add(withInfo("a", 1000, { orderNumber: "261015-5753117", trackingNumber: "JT5536390526070" }));
    const orderB = await parcelStore.add(withInfo("b", 2000, { orderNumber: "261015-2317143", trackingNumber: null }));
    await parcelStore.remove(orderB.id);
    // B scanned again, now with the tracking number it shares with A: it is not A.
    const rescanB = withInfo("b2", 3000, { orderNumber: "261015-2317143", trackingNumber: "JT5536390526070" });
    expect(await parcelStore.findFor(rescanB.analysis.parcel)).toBeUndefined();
    const added = await parcelStore.add(rescanB);
    expect(added.id).not.toBe(orderA.id);
    expect((await parcelStore.list()).map((parcel) => parcel.info.orderNumber).sort()).toEqual(["261015-2317143", "261015-5753117"]);
  });
});
