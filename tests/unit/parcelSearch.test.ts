import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { mockAnalysis } from "@/lib/ai/mock";
import { matchesSearch } from "@/lib/parcels";
import { parcelStore } from "@/services/parcelStore";
import type { HistoryEntry } from "@/types/history";

describe("matchesSearch", () => {
  const texts = ["Casque de moto carbone", "Rado", "Livré", "773445294766417", "261006-523805673050802", "Fret", 45000, null];

  it("ignores case and accents", () => {
    expect(matchesSearch(texts, "CASQUE")).toBe(true);
    expect(matchesSearch(texts, "livre")).toBe(true);
    expect(matchesSearch(texts, "rado")).toBe(true);
  });

  it("finds numbers typed with spaces or dashes, and amounts", () => {
    expect(matchesSearch(texts, "7734 4529")).toBe(true);
    expect(matchesSearch(texts, "261006523805")).toBe(true);
    expect(matchesSearch(texts, "45000")).toBe(true);
  });

  it("needs every word, and an empty query matches everything", () => {
    expect(matchesSearch(texts, "casque rado")).toBe(true);
    expect(matchesSearch(texts, "casque voahangy")).toBe(false);
    expect(matchesSearch(texts, "   ")).toBe(true);
  });
});

describe("editing a parcel", () => {
  beforeEach(async () => {
    await parcelStore.wipe();
  });

  it("saves the corrections and logs a status changed by hand", async () => {
    let analysis = mockAnalysis("auto", "fr");
    for (let i = 0; i < 5 && !analysis.parcel; i++) analysis = mockAnalysis("auto", "fr");
    const entry: HistoryEntry = { id: "s1", createdAt: 1000, mode: "auto", thumbnail: "x", preview: "x", analysis, meta: { model: "demo", demo: true, durationMs: 1 } };
    const parcel = await parcelStore.add(entry);

    await parcelStore.edit(parcel.id, { title: "Casque (Rado)", client: "  Rado ", info: { ...parcel.info, trackingNumber: "STO123" } });
    let [saved] = await parcelStore.list();
    expect(saved).toMatchObject({ title: "Casque (Rado)", client: "Rado" });
    expect(saved.info.trackingNumber).toBe("STO123");
    expect(saved.timeline).toHaveLength(1);

    await parcelStore.edit(parcel.id, { title: saved.title, client: "", info: { ...saved.info, status: "delivered", statusLabel: "Livré" } });
    [saved] = await parcelStore.list();
    expect(saved.client).toBeUndefined();
    expect(saved.timeline.map((item) => [item.status, item.scanId])).toEqual([
      ["in_transit", "s1"],
      ["delivered", ""],
    ]);
  });
});
