import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { mockReceipt } from "@/lib/ai/mock";
import { AnalysisSchema, normalizeStoredAnalysis, type Analysis } from "@/lib/ai/schema";
import { summaryRequest } from "@/lib/expenseAi";
import {
  barPercent,
  budgetLines,
  categoryBars,
  exclusionId,
  groupByDay,
  incomeKindOf,
  keepKey,
  monthBalance,
  monthExpenses,
  monthIncomes,
  monthTotals,
  receiptKey,
  saleKey,
  sourceItems,
  storedIncome,
  spendingHistory,
  type Exclusion,
  type ExpenseRecord,
  type ManualExpense,
  type ReceiptScan,
} from "@/lib/expenses";
import { subscriptionPayments } from "@/lib/plans";
import { expenseStore } from "@/services/expenseStore";
import { parcelStore, saleDate } from "@/services/parcelStore";

const day = (year: number, month: number, date: number, hour = 12) => new Date(year, month - 1, date, hour).getTime();
const base = { createdAt: 1, updatedAt: 1 };
const expense = (id: string, at: number, amountMga: number, patch: Partial<ManualExpense> = {}): ManualExpense => ({ ...base, kind: "expense", id, at, amountMga, category: "market", ...patch });
const exclusion = (sourceKey: string): Exclusion => ({ ...base, kind: "exclusion", id: exclusionId(sourceKey), sourceKey });
const parcel = (patch: Record<string, unknown>) => ({ id: "p1", title: "Robe rouge", priceMga: 60000, fees: [{ id: "f", label: "Fret", amountMga: 20000 }], createdAt: day(2026, 9, 2), ...patch });

const scan = (id: string, receipt: Partial<NonNullable<NonNullable<Analysis["document"]>["receipt"]>>, createdAt = day(2026, 10, 25)): ReceiptScan => {
  const demo = mockReceipt("fr");
  return { id, createdAt, analysis: { document: { ...demo.document!, receipt: { ...demo.document!.receipt!, ...receipt } } } };
};

describe("parcels sold count as income", () => {
  it("counts the whole sale price the month it was sold, with the profit and what is still owed", () => {
    const sources = sourceItems({ parcels: [parcel({ salePriceMga: 130000, paidMga: 100000, soldAt: day(2026, 10, 3), updatedAt: day(2026, 10, 20) })] });
    const [sale] = monthIncomes([], "2026-10", sources);
    expect(sale).toMatchObject({ key: saleKey("p1"), origin: "sale", amountMga: 130000, income: "sales", label: "Robe rouge", profitMga: 50000, unpaidMga: 30000, excluded: false });
    // The purchase stays an expense, the month the parcel was added.
    expect(monthExpenses([], sources, "2026-09").map((item) => [item.origin, item.amountMga])).toEqual([["parcel", 80000]]);
    // Never an expense itself.
    expect(monthExpenses([], sources, "2026-10")).toEqual([]);
  });

  it("counts parcels sold before the day was kept the month they were added, however often they change", () => {
    const changed = sourceItems({ parcels: [parcel({ salePriceMga: 70000, updatedAt: day(2026, 11, 4) })] });
    expect(monthIncomes([], "2026-11", changed)).toEqual([]);
    expect(monthIncomes([], "2026-09", changed)[0]).toMatchObject({ amountMga: 70000, profitMga: -10000, unpaidMga: 70000 });
  });

  it("can be kept out with “Don’t count”", () => {
    const sources = sourceItems({ parcels: [parcel({ salePriceMga: 130000, soldAt: day(2026, 10, 3) })] });
    const incomes = monthIncomes([exclusion(saleKey("p1"))], "2026-10", sources);
    expect(incomes[0].excluded).toBe(true);
    expect(monthBalance([], incomes)).toEqual({ spent: 0, earned: 0, left: 0 });
  });

  it("dates the sale when its price first appears, and forgets it with the price", () => {
    expect(saleDate({}, 50000, 42)).toBe(42);
    expect(saleDate({ salePriceMga: 50000, soldAt: 7 }, 60000, 42)).toBe(7);
    expect(saleDate({ salePriceMga: 50000 }, 60000, 42)).toBeUndefined();
    expect(saleDate({ salePriceMga: 50000, soldAt: 7 }, undefined, 42)).toBeUndefined();
  });

  it("keeps the sale day through parcelStore.setSale", async () => {
    await parcelStore.rawPut({ id: "sold", title: "Sac", info: { status: "ordered" } as never, scanIds: [], timeline: [], createdAt: 1, updatedAt: 1 } as never);
    await parcelStore.setSale("sold", { salePriceMga: 90000 });
    const first = (await parcelStore.rawGet("sold"))!.soldAt;
    expect(first).toBeGreaterThan(0);
    await parcelStore.setSale("sold", { salePriceMga: 95000, paidMga: 50000 });
    expect((await parcelStore.rawGet("sold"))!.soldAt).toBe(first);
    await parcelStore.setSale("sold", {});
    expect((await parcelStore.rawGet("sold"))!.soldAt).toBeUndefined();
  });
});

describe("scanned receipts count on their own", () => {
  const records: ExpenseRecord[] = [];

  it("counts a till receipt or a Mobile Money payment the day it was paid", () => {
    const items = monthExpenses(records, sourceItems({ receipts: [scan("s1", { date: "2026-10-20" })] }), "2026-10");
    expect(items.map((item) => [item.key, item.origin, item.amountMga, item.category, item.label, item.excluded])).toEqual([
      [receiptKey("s1"), "mobile_money", 15000, "transport", "Taxi Be Express", false],
    ]);
    expect(items[0].href).toBe("/result?id=s1");
    // No day on it: the day of the scan.
    expect(monthExpenses([], sourceItems({ receipts: [scan("s2", { date: null, payment: "cash", operator: null })] }), "2026-10")[0]).toMatchObject({ origin: "receipt", at: day(2026, 10, 25, 0) });
  });

  it("is not counted twice: typed in already, paying a bill marked paid, or moved to the household", () => {
    const sources = sourceItems({ receipts: [scan("s1", {})] });
    expect(monthExpenses([expense("m", day(2026, 10, 1), 999, { scanId: "s1" })], sources, "2026-10").map((item) => item.origin)).toEqual(["manual"]);
    expect(monthExpenses([expense("m", day(2026, 10, 1), 999, { reference: "mp261020.1432.a51234" })], sources, "2026-10").map((item) => item.origin)).toEqual(["manual"]);
    expect(monthExpenses([expense("m", day(2026, 10, 1), 999, { sourceKey: receiptKey("s1") })], sources, "2026-10").map((item) => item.origin)).toEqual(["manual"]);
    const bill = { entry: { id: "s1" }, kind: "electricity_water" as const, issuer: "JIRAMA", amountMga: 15000, paidAt: day(2026, 10, 20) };
    expect(sourceItems({ bills: [bill], receipts: [scan("s1", {})] }).map((item) => item.key)).toEqual(["bill:s1"]);
    expect(sourceItems({ receipts: [scan("s1", {})], taken: [{ scanId: "s1" }] })).toEqual([]);
    // Yuan, dollars, euros: only the form under the scan.
    expect(sourceItems({ receipts: [scan("s1", { currency: "USD" })] })).toEqual([]);
  });

  it("shows “counted already?” for the same amount within 3 days, until “count it anyway”", () => {
    const sources = sourceItems({ receipts: [scan("s1", { date: "2026-10-20" })] });
    const typed = expense("m", day(2026, 10, 18), 15000);
    const doubt = monthExpenses([typed], sources, "2026-10").find((item) => item.key === receiptKey("s1"));
    expect(doubt).toMatchObject({ key: receiptKey("s1"), doubt: true, excluded: true });
    expect(monthTotals(monthExpenses([typed], sources, "2026-10")).total).toBe(15000);
    const kept = monthExpenses([typed, exclusion(keepKey(receiptKey("s1")))], sources, "2026-10");
    expect(kept.find((item) => item.key === receiptKey("s1"))).toMatchObject({ excluded: false });
    expect(monthTotals(kept).total).toBe(30000);
    // A paid bill of the same amount, two days later.
    const bill = { entry: { id: "b" }, kind: "phone_internet" as const, issuer: "Telma", amountMga: 15000, paidAt: day(2026, 10, 22) };
    expect(monthExpenses([], sourceItems({ bills: [bill], receipts: [scan("s1", { date: "2026-10-20" })] }), "2026-10").find((item) => item.origin === "mobile_money")?.doubt).toBe(true);
    // Four days apart: two expenses.
    expect(monthExpenses([expense("m", day(2026, 10, 16), 15000)], sources, "2026-10").some((item) => item.doubt)).toBe(false);
  });

  it("keeps “Don’t count”", () => {
    const sources = sourceItems({ receipts: [scan("s1", {})] });
    expect(monthExpenses([exclusion(receiptKey("s1"))], sources, "2026-10")[0].excluded).toBe(true);
  });
});

describe("the same transaction scanned twice", () => {
  it("counts once with the same reference: money paid, received, and a withdrawal's fees", () => {
    const sms = scan("sms", { date: "2026-10-20" }, day(2026, 10, 20));
    const photo = scan("photo", { date: "2026-10-20", reference: " mp261020.1432.a51234" }, day(2026, 10, 21));
    const sources = sourceItems({ receipts: [photo, sms] });
    expect(monthExpenses([], sources, "2026-10").map((item) => item.key)).toEqual([receiptKey("sms")]);
    expect(sources.find((item) => item.key === receiptKey("photo"))?.sameAs).toBe(receiptKey("sms"));

    const received = (id: string, createdAt: number) => ({ id, createdAt, analysis: mockReceipt("fr", "in") });
    expect(monthIncomes([], "2026-10", sourceItems({ receipts: [received("a", day(2026, 10, 22)), received("b", day(2026, 10, 23))] })).map((item) => item.key)).toEqual([receiptKey("a")]);

    const withdrawal = (id: string, createdAt: number) => ({ id, createdAt, analysis: mockReceipt("fr", "own") });
    expect(monthExpenses([], sourceItems({ receipts: [withdrawal("w2", day(2026, 10, 22)), withdrawal("w1", day(2026, 10, 21))] }), "2026-10").map((item) => item.key)).toEqual([`${receiptKey("w1")}:fees`]);
  });

  it("without a reference, puts only the later scan in doubt, until “count it anyway”", () => {
    const first = scan("first", { reference: null, date: "2026-10-20" }, day(2026, 10, 20));
    const second = scan("second", { reference: null, date: "2026-10-21" }, day(2026, 10, 21));
    const sources = sourceItems({ receipts: [second, first] });
    const items = monthExpenses([], sources, "2026-10");
    expect(items.map((item) => [item.key, Boolean(item.doubt), item.excluded])).toEqual([
      [receiptKey("second"), true, true],
      [receiptKey("first"), false, false],
    ]);
    expect(monthTotals(monthExpenses([exclusion(keepKey(receiptKey("second")))], sources, "2026-10")).total).toBe(30000);
    // Money received twice, no reference: the later one in doubt.
    const received = (id: string, createdAt: number) => ({ id, createdAt, analysis: { document: { ...mockReceipt("fr", "in").document!, receipt: { ...mockReceipt("fr", "in").document!.receipt!, reference: null } } } });
    expect(monthIncomes([], "2026-10", sourceItems({ receipts: [received("a", day(2026, 10, 22)), received("b", day(2026, 10, 23))] })).map((item) => [item.key, Boolean(item.doubt)])).toEqual([
      [receiptKey("a"), false],
      [receiptKey("b"), true],
    ]);
  });

  it("puts a receipt in doubt next to a garage fill of the same amount, the fill still counted", () => {
    const vehicle = { id: "v", name: "La Corolla", fuel: [{ id: "f1", at: day(2026, 10, 19), amountMga: 15000, km: 1000, litres: 3, full: true }], maintenance: [], expenses: [] };
    const items = monthExpenses([], sourceItems({ vehicles: [vehicle as never], receipts: [scan("s1", { date: "2026-10-20" })] }), "2026-10");
    expect(items.map((item) => [item.origin, Boolean(item.doubt), item.excluded])).toEqual([
      ["mobile_money", true, true],
      ["fuel", false, false],
    ]);
  });
});

describe("money moved between one's own pockets", () => {
  const withdrawal = { id: "w1", createdAt: day(2026, 10, 21), analysis: mockReceipt("fr", "own") };

  it("reads the demo withdrawal as own, with its fees", () => {
    for (const locale of ["fr", "en"] as const) expect(AnalysisSchema.parse(mockReceipt(locale, "own")).document?.receipt).toMatchObject({ direction: "own", fees: 2600, total: 202600 });
  });

  it("is neither spent nor earned: only its fees count, on their own", () => {
    const sources = sourceItems({ receipts: [withdrawal] });
    expect(monthExpenses([], sources, "2026-10").map((item) => [item.key, item.origin, item.amountMga, item.category, item.href])).toEqual([[`${receiptKey("w1")}:fees`, "fees", 2600, "phone", "/result?id=w1"]]);
    expect(monthIncomes([], "2026-10", sources)).toEqual([]);
    // No fees shown: nothing at all.
    expect(monthExpenses([], sourceItems({ receipts: [scan("w2", { direction: "own", fees: null })] }), "2026-10")).toEqual([]);
  });

  it("counts its whole total once the user says “it’s an expense” (the fees are in it), never as income", () => {
    const sources = sourceItems({ receipts: [withdrawal] });
    const kept = monthExpenses([exclusion(keepKey(receiptKey("w1")))], sources, "2026-10");
    expect(kept.map((item) => [item.key, item.amountMga, item.excluded])).toEqual([[receiptKey("w1"), 202600, false]]);
    expect(monthIncomes([exclusion(keepKey(receiptKey("w1")))], "2026-10", sources)).toEqual([]);
  });
});

describe("Mobile Money received", () => {
  it("is an income, never an expense", () => {
    const received = mockReceipt("fr", "in");
    const sources = sourceItems({ receipts: [{ id: "r1", createdAt: day(2026, 10, 22), analysis: received }] });
    expect(monthExpenses([], sources, "2026-10")).toEqual([]);
    expect(monthIncomes([], "2026-10", sources)).toMatchObject([{ key: receiptKey("r1"), origin: "mobile_money", amountMga: 80000, label: "Rasoa Hery", excluded: false }]);
  });

  it("validates in the demo, and reads older scans as money paid", () => {
    for (const locale of ["fr", "en"] as const) expect(AnalysisSchema.parse(mockReceipt(locale, "in")).document?.receipt?.direction).toBe("in");
    const old = mockReceipt("fr");
    const { direction: _direction, ...receipt } = old.document!.receipt!;
    const parsed = AnalysisSchema.parse(normalizeStoredAnalysis({ ...old, document: { ...old.document, receipt } }));
    expect(parsed.document?.receipt?.direction).toBeNull();
    expect(sourceItems({ receipts: [{ id: "o", createdAt: 1, analysis: parsed }] })[0].flow).toBeUndefined();
  });

  it("goes in the month's review as income", () => {
    const sources = sourceItems({ receipts: [{ id: "r1", createdAt: day(2026, 10, 22), analysis: mockReceipt("fr", "in") }] });
    expect(summaryRequest([], sources, "2026-10", { locale: "fr", now: day(2026, 10, 28), categoryName: (category) => category }).income).toBe(80000);
  });
});

describe("an income every month", () => {
  it("is a recurring income: counted each month, never an expense (as an older app reads it)", async () => {
    await expenseStore.saveRecurring({ flow: "income", label: "Salaire", amountMga: 450000, category: "salary", day: 30, startMonth: "2026-10", remind: "none", skipped: [] });
    const records = await expenseStore.list();
    expect(monthIncomes(records, "2026-11").map((item) => [item.origin, item.amountMga, item.income])).toEqual([["recurring", 450000, "salary"]]);
    expect(monthExpenses(records, [], "2026-11")).toEqual([]);
    expect(spendingHistory(records, [], "2026-11", 2).months).toEqual([
      { month: "2026-10", total: 0, earned: 450000, left: 450000 },
      { month: "2026-11", total: 0, earned: 450000, left: 450000 },
    ]);
  });
});

describe("help from the family", () => {
  it("is written as an income an older app knows (“other”), and read back as help from the family", async () => {
    expect(storedIncome("family")).toEqual({ kind: "other", from: "family" });
    expect(storedIncome("salary")).toEqual({ kind: "salary" });
    const saved = await expenseStore.saveIncome({ at: day(2026, 10, 12), amountMga: 40000, ...(({ kind, from }) => ({ income: kind, from }))(storedIncome("family")), note: "Aide de la famille" });
    const stored = (await expenseStore.list()).find((record) => record.id === saved!.id);
    expect(stored).toMatchObject({ kind: "income", income: "other", from: "family", note: "Aide de la famille" });
    expect(monthIncomes([stored!], "2026-10")[0]).toMatchObject({ income: "family", label: "Aide de la famille" });
    // Every month too: category "other", named in the label.
    expect(monthIncomes([{ ...base, kind: "recurring", id: "f", flow: "income", label: "Aide de la famille", amountMga: 30000, category: "other", from: "family", day: 1, startMonth: "2026-10", remind: "none", skipped: [] }], "2026-10")[0].income).toBe("family");
    expect(incomeKindOf("family")).toBe("other");
    expect(incomeKindOf("sales")).toBe("sales");
  });
});

describe("the Assisteo subscription", () => {
  it("is an expense when the amount paid is known", () => {
    const payments = subscriptionPayments([
      { id: "a", plan: "premium", startsAt: new Date(2026, 9, 5).toISOString(), amountMga: 15000 },
      { id: "b", plan: "lite", startsAt: new Date(2026, 8, 5).toISOString(), amountMga: null },
    ]);
    expect(payments).toEqual([{ id: "a", plan: "premium", amountMga: 15000, paidAt: new Date(2026, 9, 5).getTime() }]);
    expect(monthExpenses([], sourceItems({ payments }), "2026-10")).toMatchObject([{ key: "plan:a", origin: "plan", amountMga: 15000, label: "Assisteo Premium", href: "/plans" }]);
  });
});

describe("the month's screen", () => {
  const items = monthExpenses([expense("a", day(2026, 10, 3, 9), 5000), expense("b", day(2026, 10, 3, 18), 8000, { category: "transport" }), expense("c", day(2026, 10, 7), 2000)], [], "2026-10");

  it("groups the lines by day, the latest first, and filters a category", () => {
    expect(groupByDay(items).map(({ day: start, items: lines }) => [new Date(start).getDate(), lines.map((line) => line.amountMga)])).toEqual([
      [7, [2000]],
      [3, [8000, 5000]],
    ]);
    expect(groupByDay(items, "transport").map(({ items: lines }) => lines.map((line) => line.amountMga))).toEqual([[8000]]);
  });

  it("shows each category's share, or what it spent against its cap", () => {
    const bars = categoryBars(monthTotals(items), { categories: { transport: 10000 } });
    expect(bars).toEqual([
      { category: "transport", amount: 8000, cap: 10000, ratio: 0.8, level: "warning" },
      { category: "market", amount: 7000, cap: null, ratio: 7000 / 15000, level: null },
    ]);
  });

  it("fills the budget bars, warns at 80 % and goes red beyond the cap", () => {
    const lines = budgetLines({ total: 12000, categories: { market: 10000 } }, monthTotals(items));
    expect(lines.map((line) => [line.scope, line.level, barPercent(line.ratio)])).toEqual([
      ["total", "over", 100],
      ["market", "ok", 70],
    ]);
    expect(barPercent(0.799)).toBe(80);
    expect(barPercent(-1)).toBe(0);
  });
});
