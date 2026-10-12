import { describe, expect, it } from "vitest";
import { AnalysisSchema, normalizeStoredAnalysis, type Analysis } from "@/lib/ai/schema";
import { mockAnalysis } from "@/lib/ai/mock";
import { billOf, billTotals, listBills, monthlySpending, spendingByKind, startOfMonth } from "@/lib/bills";

const base = mockAnalysis("document", "fr");
type Bill = NonNullable<NonNullable<Analysis["document"]>["bill"]>;
const scan = (id: string, bill: Partial<Bill> | null, expense?: { amountMga?: number; paidAt?: number; hidden?: boolean }, createdAt = 0) => ({
  id,
  createdAt,
  analysis: {
    title: id,
    document: { ...base.document!, bill: bill && { issuer: "JIRAMA", kind: "electricity_water" as const, amount: 45_000, currency: "MGA", period: null, dueDate: null, ...bill } },
  },
  expense,
});
const now = new Date(2026, 9, 9, 12).getTime();
const day = (m: number, d: number) => new Date(2026, m - 1, d).getTime();

describe("my bills", () => {
  it("reads the amount in ariary, or waits for the user's", () => {
    expect(billOf(scan("a", {}), now)).toMatchObject({ amountMga: 45_000, foreignAmount: null, issuer: "JIRAMA", status: "due" });
    expect(billOf(scan("b", { amount: 84.2, currency: "EUR" }), now)).toMatchObject({ amountMga: null, foreignAmount: "84.2 EUR" });
    expect(billOf(scan("c", { amount: 84.2, currency: "EUR" }, { amountMga: 520_000 }), now)?.amountMga).toBe(520_000);
    // No currency printed: a bill in Madagascar is in ariary.
    expect(billOf(scan("d", { amount: 12_000, currency: null }), now)?.amountMga).toBe(12_000);
  });

  it("follows bills the AI found or the user added, until hidden", () => {
    expect(billOf(scan("none", null), now)).toBeNull();
    expect(billOf(scan("added", null, {}), now)).toMatchObject({ kind: "other", amountMga: null });
    expect(billOf(scan("hidden", {}, { hidden: true }), now)).toBeNull();
  });

  it("knows what is paid, due or overdue, and the month it counts in", () => {
    expect(billOf(scan("late", { dueDate: "2026-10-01" }), now)).toMatchObject({ status: "overdue", month: startOfMonth(day(10, 1)) });
    expect(billOf(scan("due", { dueDate: "2026-10-20" }), now)?.status).toBe("due");
    expect(billOf(scan("paid", { dueDate: "2026-10-01" }, { paidAt: day(9, 28) }), now)).toMatchObject({ status: "paid", month: startOfMonth(day(9, 28)) });
  });

  it("sums the month, what is left to pay, and each month and kind", () => {
    const bills = listBills(
      [
        scan("phone", { kind: "phone_internet", amount: 20_000, dueDate: "2026-10-25" }),
        scan("jirama", { dueDate: "2026-10-02" }),
        scan("old", { dueDate: "2026-08-10" }, { paidAt: day(8, 9) }),
        scan("rent", { kind: "rent", amount: 300_000 }, { paidAt: day(10, 3) }),
        scan("euro", { amount: 84.2, currency: "EUR", dueDate: "2026-10-30" }),
      ],
      now,
    );
    expect(bills.map((bill) => bill.entry.id)).toEqual(["jirama", "phone", "euro", "rent", "old"]);
    expect(billTotals(bills, now)).toEqual({ thisMonth: 365_000, toPay: 65_000, unpriced: 1 });
    expect(monthlySpending(bills, now).map((month) => month.total)).toEqual([0, 0, 0, 45_000, 0, 365_000]);
    expect(spendingByKind(bills, now)).toEqual([
      { kind: "rent", total: 300_000 },
      { kind: "electricity_water", total: 45_000 },
      { kind: "phone_internet", total: 20_000 },
    ]);
  });

  it("still reads documents saved before bills existed", () => {
    const old = { ...base, document: { ...base.document } as Record<string, unknown> };
    delete old.document.bill;
    expect(AnalysisSchema.safeParse(normalizeStoredAnalysis(old)).success).toBe(true);
  });
});
