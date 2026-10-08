import { describe, expect, it } from "vitest";
import fr from "@/locales/fr.json";
import ExcelJS from "exceljs";
import { parcelsWorkbook } from "@/lib/parcelExport";
import { clientSummaries, inPeriod, isForClient } from "@/lib/parcelReport";
import type { ParcelInfo } from "@/lib/parcels";
import type { Parcel } from "@/services/parcelStore";

const info = (patch: Partial<ParcelInfo> = {}): ParcelInfo => ({
  platform: "Temu",
  orderNumber: "PO-1",
  trackingNumber: "YT1",
  carrier: "YunExpress",
  status: "in_transit",
  statusLabel: "En transit",
  lastEvent: null,
  items: [],
  total: null,
  seller: null,
  orderedAt: null,
  shippedAt: null,
  estimatedDelivery: null,
  destinationCity: null,
  ...patch,
});
const parcel = (id: string, patch: Partial<Parcel> = {}): Parcel => ({
  id,
  title: `Colis ${id}`,
  info: info(),
  scanIds: [],
  timeline: [],
  createdAt: new Date(2026, 9, 5).getTime(),
  updatedAt: 0,
  ...patch,
});

// A tiny "t" over the French texts, like the app's.
const t = (key: string) => key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], fr) as string;

describe("clients", () => {
  const parcels = [
    parcel("a", { client: "Rado", priceMga: 100000, fees: [{ id: "f", label: "Fret", amountMga: 20000 }] }),
    parcel("b", { client: "rado ", priceMga: 50000, receivedAt: 1 }),
    parcel("c", { client: "Voahangy", priceMga: 300000 }),
    parcel("d", { priceMga: 10000 }),
  ];

  it("adds up each client's parcels, whatever the case, biggest first, those without a client last", () => {
    expect(clientSummaries(parcels)).toEqual([
      { name: "Voahangy", parcels: 1, ongoing: 1, totalMga: 300000 },
      { name: "Rado", parcels: 2, ongoing: 1, totalMga: 170000 },
      { name: null, parcels: 1, ongoing: 1, totalMga: 10000 },
    ]);
    expect(parcels.filter((item) => isForClient(item, "RADO")).map((item) => item.id)).toEqual(["a", "b"]);
    expect(parcels.filter((item) => isForClient(item, null)).map((item) => item.id)).toEqual(["d"]);
  });

  it("puts a parcel in the month of its order, else of when it was added", () => {
    const now = new Date(2026, 9, 20).getTime();
    const ordered = parcel("o", { info: info({ orderedAt: "2026-09-28" }) });
    expect(inPeriod(ordered, "month", now)).toBe(false);
    expect(inPeriod(ordered, "lastMonth", now)).toBe(true);
    expect(inPeriod(parcel("n"), "month", now)).toBe(true);
    expect(inPeriod(ordered, "all", now)).toBe(true);
  });

  it("keeps the parcels of chosen days, both days included", () => {
    const now = new Date(2026, 9, 20).getTime();
    const range = { from: "2026-09-28", to: "2026-10-02" };
    expect(inPeriod(parcel("first", { info: info({ orderedAt: "2026-09-28" }) }), "custom", now, range)).toBe(true);
    expect(inPeriod(parcel("last", { info: info({ orderedAt: "2026-10-02" }) }), "custom", now, range)).toBe(true);
    expect(inPeriod(parcel("after", { info: info({ orderedAt: "2026-10-03" }) }), "custom", now, range)).toBe(false);
    expect(inPeriod(parcel("any"), "custom", now, { from: "2026-10-05", to: "2026-10-01" })).toBe(false);
  });
});

describe("export", () => {
  it("writes an Excel workbook: a parcels table with amounts in ariary and a total, then a sheet per client", async () => {
    const bytes = await parcelsWorkbook(
      [
        parcel("a", {
          client: "Rado",
          title: "Casque carbone",
          info: info({ orderedAt: "2026-10-01", items: [{ name: "Casque", variant: "Noir, M", quantity: 2, price: "¥215" }] }),
          priceMga: 120000,
          fees: [
            { id: "f1", label: "Fret", amountMga: 45000 },
            { id: "f2", label: "Douane", amountMga: 30000 },
          ],
          receivedAt: new Date(2026, 9, 7, 12).getTime(),
        }),
        parcel("b", { client: "Voahangy", title: "Robe", priceMga: 50000 }),
      ],
      t,
      "fr",
      { title: "Mes colis · octobre 2026", subtitle: "Exporté le 8 oct. 2026" },
    );

    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes);
    const sheet = book.getWorksheet("Colis")!;
    expect(sheet.getCell("A1").value).toBe("Mes colis · octobre 2026");
    expect(sheet.getRow(4).values).toContain("Prix de l’article");

    // First parcel: amounts are numbers shown as "120 000 Ar", days are dates.
    const price = sheet.getCell("K5");
    expect(price.value).toBe(120000);
    expect(price.numFmt).toBe('#,##0" Ar"');
    expect(sheet.getCell("L5").value).toBe(75000);
    expect(sheet.getCell("N5").value).toBe(195000);
    expect((sheet.getCell("H5").value as Date).toISOString().slice(0, 10)).toBe("2026-10-01");
    expect(sheet.getCell("G5").value).toBe("Reçu");
    expect(String(sheet.getCell("M5").value)).toMatch(/^Fret 45\s000 Ar, Douane 30\s000 Ar$/);

    // The totals row, with its value for previews that don't compute.
    expect(sheet.getCell("A7").value).toBe("Total");
    const total = sheet.getCell("N7").value as { formula: string; result: number };
    expect(total.formula).toMatch(/SUBTOTAL\(109/);
    expect(total.result).toBe(245000);
    expect(sheet.getCell("N7").numFmt).toBe('#,##0" Ar"');

    const recap = book.getWorksheet("Par client")!;
    expect(recap.getCell("A5").value).toBe("Rado");
    expect(recap.getCell("E5").value).toBe(195000);
    expect((recap.getCell("E7").value as { result: number }).result).toBe(245000);
  });
});
