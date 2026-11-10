import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { mockAnalysis } from "@/lib/ai/mock";
import { FREIGHT_FEE_ID, freightMga, freightMode, knownForwarders, lotSummaries, parseWeight, rememberedRate, withFreightFee } from "@/lib/parcelLots";
import { parcelStore, parcelProfitMga, parcelTotalMga, type Parcel } from "@/services/parcelStore";
import { statementLines } from "@/services/parcelStatement";
import type { HistoryEntry } from "@/types/history";

const demo = (() => {
  for (let i = 0; i < 6; i++) {
    const analysis = mockAnalysis("auto", "fr");
    if (analysis.parcel) return analysis;
  }
  throw new Error("no demo parcel");
})();

const t = (key: string, params?: Record<string, string | number>) => (params ? `${key} ${JSON.stringify(params)}` : key);

const parcel = (id: string, patch: Partial<Parcel> = {}): Parcel => ({
  id,
  title: id,
  info: { ...demo.parcel!, status: "in_transit" },
  scanIds: [],
  timeline: [],
  createdAt: 1000,
  updatedAt: 1000,
  ...patch,
});

const scan = (id: string, orderNumber: string): HistoryEntry => ({
  id,
  createdAt: 1000,
  mode: "auto",
  thumbnail: "data:image/jpeg;base64,AA",
  preview: "data:image/jpeg;base64,AA",
  analysis: { ...demo, parcel: { ...demo.parcel!, orderNumber, trackingNumber: null, status: "in_transit" } },
  meta: { model: "demo", demo: true, durationMs: 1 },
});

describe("freight by the kilo", () => {
  it("is the weight times the rate, rounded, and nothing when one is missing", () => {
    expect(freightMga({ weightKg: 2.5, rateMga: 12_000 })).toBe(30_000);
    expect(freightMga({ weightKg: 0.333, rateMga: 10_000 })).toBe(3_330);
    expect(freightMga({ weightKg: 0, rateMga: 12_000 })).toBe(0);
    expect(freightMga(null)).toBe(0);
    expect(parseWeight("2,5")).toBe(2.5);
    expect(parseWeight("1.2345")).toBe(1.235);
    expect(parseWeight("")).toBe(0);
  });

  it("is one fee, replaced and not added twice, so totals and profit count it", () => {
    const fees = [{ id: "f1", label: "Douane", amountMga: 5_000 }];
    const once = withFreightFee(fees, { weightKg: 2, rateMga: 10_000 }, "Fret");
    const twice = withFreightFee(once, { weightKg: 3, rateMga: 10_000 }, "Fret");
    expect(twice).toEqual([{ id: FREIGHT_FEE_ID, label: "Fret", amountMga: 30_000 }, fees[0]]);
    expect(withFreightFee(twice, null, "")).toEqual(fees);
    const sold = parcel("a", { priceMga: 50_000, fees: twice, salePriceMga: 100_000 });
    expect(parcelTotalMga(sold)).toBe(85_000);
    expect(parcelProfitMga(sold)).toBe(15_000);
  });

  it("remembers each forwarder's last rate, whatever the case", () => {
    const parcels = [
      parcel("a", { updatedAt: 1, freight: { forwarder: "Trans Mada", weightKg: 1, rateMga: 10_000 } }),
      parcel("b", { updatedAt: 3, freight: { forwarder: "trans mada ", weightKg: 1, rateMga: 12_000 } }),
      parcel("c", { updatedAt: 2, freight: { forwarder: "Colis Express", weightKg: 1, rateMga: 9_000 } }),
    ];
    expect(rememberedRate(parcels, "TRANS MADA")).toBe(12_000);
    expect(rememberedRate(parcels, "Autre")).toBeNull();
    expect(rememberedRate(parcels, "")).toBeNull();
    expect(knownForwarders(parcels)).toEqual(["trans mada", "Colis Express"]);
  });

  it("keeps a sea rate and an air rate per forwarder; a rate without a mode stands for both", () => {
    const parcels = [
      parcel("old", { updatedAt: 1, freight: { forwarder: "Trans Mada", weightKg: 1, rateMga: 11_000 } }),
      parcel("sea", { updatedAt: 2, freight: { forwarder: "Trans Mada", weightKg: 1, rateMga: 8_000, mode: "sea" } }),
      parcel("air", { updatedAt: 3, freight: { forwarder: "Trans Mada", weightKg: 1, rateMga: 45_000, mode: "air" } }),
      parcel("other", { updatedAt: 4, freight: { forwarder: "Colis Express", weightKg: 1, rateMga: 9_000 } }),
    ];
    expect(rememberedRate(parcels, "Trans Mada", "sea")).toBe(8_000);
    expect(rememberedRate(parcels, "Trans Mada", "air")).toBe(45_000);
    // Mode unknown: the last rate typed.
    expect(rememberedRate(parcels, "Trans Mada", null)).toBe(45_000);
    // Only a rate without a mode: it serves both.
    expect(rememberedRate(parcels, "Colis Express", "sea")).toBe(9_000);
    expect(rememberedRate(parcels, "Colis Express", "air")).toBe(9_000);
    // A sea rate never serves the air.
    expect(rememberedRate(parcels.filter((item) => item.id === "sea"), "Trans Mada", "air")).toBeNull();
    // The shipment's mode wins over the parcel's own.
    expect(freightMode({ lot: { id: "l", name: "Conteneur", mode: "sea" } }, "air")).toBe("sea");
    expect(freightMode({ lot: { id: "l", name: "Lot" } }, "air")).toBe("air");
    expect(freightMode({}, null)).toBeUndefined();
  });

  it("shows the weight on the client's statement, never the freight paid", () => {
    const lines = statementLines(
      parcel("a", {
        client: "Rado",
        lot: { id: "l", name: "Conteneur novembre" },
        freight: { weightKg: 2.5, rateMga: 12_000 },
        fees: withFreightFee([], { weightKg: 2.5, rateMga: 12_000 }, "Fret 2,5 kg × 12 000 Ar"),
      }),
      t,
      "fr",
    );
    const text = JSON.stringify(lines);
    expect(text).toContain("Conteneur novembre");
    expect(text).toContain('parcelLots.kg {\\"weight\\":\\"2,5\\"}');
    expect(text).not.toMatch(/30\D000|12\D000|Fret/);
  });
});

describe("shipments", () => {
  it("add up their parcels: weight, freight, paid and still owed; the latest departure first", () => {
    const sea = { id: "sea", name: "Conteneur", mode: "sea" as const, departedAt: "2026-10-01" };
    const air = { id: "air", name: "Avion", mode: "air" as const, departedAt: "2026-11-01" };
    const summaries = lotSummaries([
      parcel("a", { lot: sea, freight: { weightKg: 2, rateMga: 10_000 }, fees: withFreightFee([], { weightKg: 2, rateMga: 10_000 }, "Fret"), salePriceMga: 80_000, paidMga: 30_000 }),
      parcel("b", { lot: sea, freight: { weightKg: 1.5, rateMga: 10_000 }, fees: withFreightFee([], { weightKg: 1.5, rateMga: 10_000 }, "Fret"), receivedAt: 5 }),
      parcel("c", { lot: air, salePriceMga: 20_000, paidMga: 25_000 }),
      parcel("d"),
    ]);
    expect(summaries.map((summary) => summary.lot.id)).toEqual(["air", "sea"]);
    expect(summaries[1]).toMatchObject({ ongoing: 1, weightKg: 3.5, freightMga: 35_000, paidMga: 30_000, dueMga: 50_000 });
    expect(summaries[1].parcels.map((item) => item.id)).toEqual(["a", "b"]);
    expect(summaries[0]).toMatchObject({ dueMga: 0, paidMga: 25_000 });
  });

  it("take the details of their latest updated parcel", () => {
    const [summary] = lotSummaries([parcel("a", { updatedAt: 1, lot: { id: "l", name: "Ancien nom" } }), parcel("b", { updatedAt: 2, lot: { id: "l", name: "Nouveau nom" } })]);
    expect(summary.lot.name).toBe("Nouveau nom");
  });
});

describe("the parcel store", () => {
  it("keeps the freight fee when the costs are saved without it (no reseller tools)", async () => {
    await parcelStore.wipe();
    const added = await parcelStore.add(scan("s1", "A-1"));
    const freight = { forwarder: "Trans Mada", weightKg: 2, rateMga: 10_000 };
    await parcelStore.setCosts(added.id, { priceMga: 40_000, fees: withFreightFee([], freight, "Fret"), freight });
    await parcelStore.setCosts(added.id, { priceMga: 45_000, fees: [{ id: "f1", label: "Douane", amountMga: 1_000 }] });
    let saved = (await parcelStore.rawGet(added.id))!;
    expect(saved.freight).toEqual(freight);
    expect(parcelTotalMga(saved)).toBe(66_000);
    await parcelStore.setCosts(added.id, { priceMga: 45_000, fees: [], freight: null });
    saved = (await parcelStore.rawGet(added.id))!;
    expect(saved.freight).toBeUndefined();
    expect(parcelTotalMga(saved)).toBe(45_000);
  });

  it("groups parcels, renames the shipment on all of them, and moves them all to a status", async () => {
    await parcelStore.wipe();
    const a = await parcelStore.add(scan("s1", "A-1"));
    const b = await parcelStore.add(scan("s2", "B-2"));
    const c = await parcelStore.add(scan("s3", "C-3"));
    await parcelStore.markReceived((await parcelStore.rawGet(c.id))!, true);
    const lot = { id: "l1", name: "Conteneur", mode: "sea" as const };
    await parcelStore.setLot([a.id, b.id, c.id], lot);
    expect((await parcelStore.rawGet(a.id))!.shippingMode).toBe("sea");

    await parcelStore.updateLot({ ...lot, name: "Conteneur de novembre" });
    expect((await parcelStore.list()).map((item) => item.lot?.name)).toEqual(["Conteneur de novembre", "Conteneur de novembre", "Conteneur de novembre"]);

    // The parcel already received is left as it is.
    expect(await parcelStore.setLotStatus("l1", "pickup_ready", "Prêt à retirer")).toBe(2);
    // Already at that status: none changed, none counted.
    expect(await parcelStore.setLotStatus("l1", "pickup_ready", "Prêt à retirer")).toBe(0);
    const moved = (await parcelStore.rawGet(a.id))!;
    expect(moved.info).toMatchObject({ status: "pickup_ready", statusLabel: "Prêt à retirer" });
    expect(moved.timeline.at(-1)).toMatchObject({ status: "pickup_ready", scanId: "" });
    expect((await parcelStore.rawGet(c.id))!.info.status).toBe("in_transit");

    expect(await parcelStore.setLotStatus("l1", "received", "Reçu")).toBe(2);
    expect((await parcelStore.list()).every((item) => item.receivedAt)).toBe(true);

    await parcelStore.setLot([b.id], null);
    expect((await parcelStore.rawGet(b.id))!.lot).toBeUndefined();
    expect((await parcelStore.rawGet(b.id))!.shippingMode).toBe("sea");
  });

  it("keeps one name per shipment: a parcel back from another device with the old name takes the latest", async () => {
    await parcelStore.wipe();
    const a = await parcelStore.add(scan("s1", "A-1"));
    const b = await parcelStore.add(scan("s2", "B-2"));
    await parcelStore.setLot([a.id, b.id], { id: "l1", name: "Conteneur", updatedAt: 1 });
    await parcelStore.updateLot({ id: "l1", name: "Conteneur de novembre", updatedAt: 5 });
    // Parcel b changed on another device before it saw the rename: it comes back with the old name, and later.
    await parcelStore.rawPut({ ...(await parcelStore.rawGet(b.id))!, lot: { id: "l1", name: "Conteneur", updatedAt: 1 }, updatedAt: Date.now() + 1000 });
    expect(lotSummaries(await parcelStore.list())[0].lot.name).toBe("Conteneur de novembre");
    await parcelStore.reconcileLots();
    expect((await parcelStore.list()).map((item) => item.lot?.name)).toEqual(["Conteneur de novembre", "Conteneur de novembre"]);
    // Settled: nothing more to write.
    const before = (await parcelStore.rawGet(b.id))!.updatedAt;
    await parcelStore.reconcileLots();
    expect((await parcelStore.rawGet(b.id))!.updatedAt).toBe(before);
  });

  it("gives a client's corrected number to their other parcels that had one", async () => {
    await parcelStore.wipe();
    const a = await parcelStore.add(scan("s1", "A-1"));
    const b = await parcelStore.add(scan("s2", "B-2"));
    const c = await parcelStore.add(scan("s3", "C-3"));
    const d = await parcelStore.add(scan("s4", "D-4"));
    const info = (await parcelStore.rawGet(a.id))!.info;
    await parcelStore.edit(a.id, { title: "A", client: "Rado", clientPhone: "034 11 111 11", info });
    await parcelStore.edit(b.id, { title: "B", client: "rado ", clientPhone: "034 11 111 11", info });
    await parcelStore.edit(c.id, { title: "C", client: "Rado", info });
    await parcelStore.edit(d.id, { title: "D", client: "Voahangy", clientPhone: "033 33 333 33", info });
    await parcelStore.edit(a.id, { title: "A", client: "Rado", clientPhone: "034 22 222 22", info });
    await parcelStore.setClientPhone("Rado", "034 22 222 22", a.id);
    expect((await parcelStore.rawGet(b.id))!.clientPhone).toBe("034 22 222 22");
    // Without a number of its own, it already takes the client's (clientPhone).
    expect((await parcelStore.rawGet(c.id))!.clientPhone).toBeUndefined();
    expect((await parcelStore.rawGet(d.id))!.clientPhone).toBe("033 33 333 33");
  });
});

describe("the Excel export", () => {
  it("writes the weight as a number in kilos, with a total rounded to the gram", async () => {
    const { parcelsWorkbook, WEIGHT } = await import("@/lib/parcelExport");
    const ExcelJS = (await import("exceljs")).default;
    const t = (key: string) => key;
    const bytes = await parcelsWorkbook(
      [parcel("a", { freight: { weightKg: 0.1, rateMga: 10_000 } }), parcel("b", { freight: { weightKg: 0.2, rateMga: 10_000 } })],
      t,
      "fr",
      { title: "Mes colis", subtitle: "" },
    );
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes);
    const sheet = book.worksheets[0];
    const header = sheet.getRow(4).values as unknown[];
    const column = header.indexOf("parcelLots.columns.weightKg");
    expect(column).toBeGreaterThan(0);
    expect(sheet.getCell(5, column).value).toBe(0.1);
    expect(sheet.getCell(5, column).numFmt).toBe(WEIGHT);
    const total = sheet.getCell(7, column).value as { result: number };
    expect(total.result).toBe(0.3);
    expect(sheet.getCell(7, column).numFmt).toBe(WEIGHT);
  });
});
