import { describe, expect, it } from "vitest";
import { mockAnalysis } from "@/lib/ai/mock";
import { statementLines, statementTotals } from "@/services/parcelStatement";
import type { Parcel } from "@/services/parcelStore";

const demoParcel = (() => {
  for (let i = 0; i < 6; i++) {
    const analysis = mockAnalysis("auto", "fr");
    if (analysis.parcel) return analysis.parcel;
  }
  throw new Error("no demo parcel");
})();

const t = (key: string, params?: Record<string, string | number>) => (params ? `${key} ${JSON.stringify(params)}` : key);

const parcel = (patch: Partial<Parcel> = {}): Parcel => ({
  id: "p",
  title: "Chaussures",
  client: "Rado",
  info: demoParcel,
  scanIds: [],
  timeline: [],
  createdAt: 1000,
  updatedAt: 1000,
  ...patch,
});

describe("a client's statement", () => {
  it("never shows what the parcel cost the reseller", () => {
    const sold = parcel({ priceMga: 61_000, fees: [{ id: "f", label: "Fret", amountMga: 9_000 }], salePriceMga: 85_000, paidMga: 50_000 });
    const lines = statementLines(sold, t, "fr");
    const text = JSON.stringify(lines);
    // Amounts are written "61 000 Ar": a separator between the digits.
    expect(text).not.toMatch(/61\D000|(^|\D)9\D000|70\D000|15\D000|Fret/);
    expect(lines.map((line) => line.label)).toEqual(expect.arrayContaining(["parcels.statement.amount", "parcels.statement.paid", "parcels.statement.due"]));
    expect(lines.find((line) => line.label === "parcels.statement.due")?.value).toMatch(/35/);
  });

  it("has no amounts without a sale price, and says when it was received", () => {
    const lines = statementLines(parcel({ priceMga: 61_000, receivedAt: new Date(2026, 9, 12).getTime() }), t, "fr");
    expect(lines.some((line) => line.label.startsWith("parcels.statement."))).toBe(false);
    expect(lines[0].value).toContain("parcels.statement.receivedOn");
    expect(JSON.stringify(lines)).not.toMatch(/61\D000/);
  });

  it("adds up sale prices only", () => {
    const totals = statementTotals([
      parcel({ salePriceMga: 85_000, paidMga: 50_000, priceMga: 61_000 }),
      parcel({ salePriceMga: 40_000, priceMga: 30_000 }),
      parcel({ priceMga: 99_000, paidMga: 5_000 }),
    ]);
    expect(totals).toEqual({ totalMga: 125_000, paidMga: 50_000, dueMga: 75_000 });
  });
});
