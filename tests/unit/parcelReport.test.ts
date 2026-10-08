import { describe, expect, it } from "vitest";
import fr from "@/locales/fr.json";
import { parcelsCsv } from "@/lib/parcelExport";
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
});

describe("export", () => {
  it("writes a CSV Excel opens in French: BOM, semicolons, quoted cells, plain amounts", () => {
    const csv = parcelsCsv(
      [
        parcel("a", {
          client: "Rado",
          title: 'Casque "carbone"; noir',
          info: info({ orderedAt: "2026-10-01", items: [{ name: "Casque", variant: "Noir, M", quantity: 2, price: "¥215" }] }),
          priceMga: 120000,
          fees: [
            { id: "f1", label: "Fret", amountMga: 45000 },
            { id: "f2", label: "Douane", amountMga: 30000 },
          ],
          receivedAt: new Date(2026, 9, 7, 12).getTime(),
        }),
      ],
      t,
    );
    expect(csv.startsWith("﻿Client;Colis;Plateforme;")).toBe(true);
    const [, row] = csv.trim().split("\r\n");
    expect(row).toBe('Rado;"Casque ""carbone""; noir";Temu;PO-1;YT1;YunExpress;Reçu;2026-10-01;2026-10-07;Casque (Noir, M) ×2;120000;75000;Fret 45000, Douane 30000;195000');
  });
});
