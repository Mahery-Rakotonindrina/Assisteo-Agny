import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  ACTIVITY_ID,
  byKind,
  exclusionId,
  isForResale,
  monthBalance,
  monthExpenses,
  monthIncomes,
  saleKey,
  sourceItems,
  type ActivitySetting,
  type ExpenseRecord,
  type SavingsGoal,
  type Tontine,
  type Wallet,
} from "@/lib/expenses";
import { activityKey, activityLines, activityMonth, budgetSources, costKey, excludedKeys, separatesActivity } from "@/lib/resale";
import { removalEffect } from "@/lib/savings";
import { walletBook } from "@/lib/wallets";
import { expenseStore } from "@/services/expenseStore";
import { parcelStore, type Parcel } from "@/services/parcelStore";

const day = (year: number, month: number, date: number, hour = 12) => new Date(year, month - 1, date, hour).getTime();
const start = day(2026, 9, 1, 8);
const base = { createdAt: start, updatedAt: start };
const now = day(2026, 10, 29, 18);

const parcel = (id: string, patch: Partial<Parcel> = {}): Parcel => ({
  id,
  title: `Colis ${id}`,
  info: { status: "in_transit" } as Parcel["info"],
  scanIds: [],
  timeline: [],
  createdAt: day(2026, 10, 2),
  updatedAt: day(2026, 10, 2),
  priceMga: 60000,
  fees: [{ id: "f", label: "Fret", amountMga: 20000 }],
  ...patch,
});
const setting = (separate: boolean): ActivitySetting => ({ ...base, kind: "activity", id: ACTIVITY_ID, separate });
const exclusion = (sourceKey: string): ExpenseRecord => ({ ...base, kind: "exclusion", id: exclusionId(sourceKey), sourceKey });
const wallet: Wallet = { ...base, kind: "wallet", id: "cash", name: "Espèces", type: "cash", startMga: 500000, startAt: start, primary: true };

// Sold in October: Rado's dress (cost 80 000, sold 130 000, 30 000 still owed), Vola's shoes (cost 40 000, sold 50 000).
// Still in stock: a bag for a client (cost 80 000). Mine: a phone case (cost 15 000).
const parcels = [
  parcel("dress", { client: "Rado", salePriceMga: 130000, paidMga: 100000, soldAt: day(2026, 10, 10) }),
  parcel("shoes", { client: "Vola", priceMga: 40000, fees: [], salePriceMga: 50000, paidMga: 50000, soldAt: day(2026, 10, 12) }),
  parcel("bag", { client: "rado" }),
  parcel("case", { priceMga: 15000, fees: [] }),
];
const sources = sourceItems({ parcels });

describe("a parcel to resell", () => {
  it("has a client or a sale price, or was marked so by hand ('for me' by hand wins)", () => {
    expect(isForResale({})).toBe(false);
    expect(isForResale({ client: "  " })).toBe(false);
    expect(isForResale({ client: "Rado" })).toBe(true);
    expect(isForResale({ salePriceMga: 50000 })).toBe(true);
    expect(isForResale({ forResale: true })).toBe(true);
    expect(isForResale({ client: "Rado", salePriceMga: 50000, forResale: false })).toBe(false);
  });

  it("keeps the choice through parcelStore.setForResale, and an older app's save keeps it too", async () => {
    await parcelStore.rawPut(parcel("p1"));
    await parcelStore.setForResale("p1", true);
    await parcelStore.setCosts("p1", { priceMga: 70000, fees: [] });
    expect(await parcelStore.rawGet("p1")).toMatchObject({ forResale: true, priceMga: 70000 });
  });
});

describe("kept apart: off", () => {
  it("counts exactly as before: the costs are expenses, the sales incomes", () => {
    expect(budgetSources(sources, false)).toBe(sources);
    expect(monthExpenses([], sources, "2026-10").map((item) => item.amountMga).sort((a, b) => a - b)).toEqual([15000, 40000, 80000, 80000]);
    expect(monthIncomes([], "2026-10", sources).map((item) => [item.key, item.amountMga])).toEqual([
      [saleKey("shoes"), 50000],
      [saleKey("dress"), 130000],
    ]);
  });

  it("is off when never set, or set off", () => {
    expect(separatesActivity([])).toBe(false);
    expect(separatesActivity([setting(false)])).toBe(false);
    expect(separatesActivity([{ ...setting(true), deletedAt: 1 }])).toBe(false);
    expect(separatesActivity([setting(true)])).toBe(true);
  });
});

describe("kept apart: on", () => {
  const house = budgetSources(sources, true);

  it("leaves the parcels to resell out of the budget, and counts the month's profit once", () => {
    const items = monthExpenses([], house, "2026-10");
    expect(items.map((item) => item.key)).toEqual(["parcel:case"]);
    const incomes = monthIncomes([], "2026-10", house);
    // (130 000 − 80 000) + (50 000 − 40 000); the bag not sold yet is left out.
    expect(incomes).toEqual([expect.objectContaining({ key: activityKey("2026-10"), origin: "activity", amountMga: 60000, income: "sales", excluded: false })]);
    expect(incomes[0].at).toBe(day(2026, 10, 12));
    expect(monthBalance(items, incomes)).toEqual({ spent: 15000, earned: 60000, left: 45000 });
  });

  it("can be left out ('don't count')", () => {
    expect(monthIncomes([exclusion(activityKey("2026-10"))], "2026-10", house)[0].excluded).toBe(true);
  });

  it("shows no line when the month's profit is zero or a loss", () => {
    const loss = sourceItems({ parcels: [parcel("x", { client: "Rado", salePriceMga: 70000, soldAt: day(2026, 10, 10) })] });
    expect(monthIncomes([], "2026-10", budgetSources(loss, true))).toEqual([]);
    expect(monthExpenses([], budgetSources(loss, true), "2026-10")).toEqual([]);
  });

  it("counts a parcel marked 'for me' by hand in the budget, sold or not", () => {
    const mine = sourceItems({ parcels: [parcel("x", { client: "Rado", forResale: false })] });
    expect(monthExpenses([], budgetSources(mine, true), "2026-10").map((item) => item.key)).toEqual(["parcel:x"]);
  });

  it("doesn't change the pockets: what was paid and received is real money", () => {
    const records = [wallet, setting(true)];
    expect(walletBook(records, sources, now).balances.get("cash")).toBe(walletBook([wallet], sources, now).balances.get("cash"));
    // 500 000 − 80 000 × 2 − 40 000 − 15 000 + 130 000 + 50 000
    expect(walletBook(records, sources, now).balances.get("cash")).toBe(465000);
  });

  it("is saved as one record that an older app leaves aside (it filters by kind)", async () => {
    await expenseStore.setActivitySeparate(true);
    await expenseStore.setActivitySeparate(false);
    const records = await expenseStore.list();
    expect(byKind(records, "activity")).toHaveLength(1);
    expect(separatesActivity(records)).toBe(false);
    // An older app only reads the kinds it knows: no expense, income or budget comes from it.
    expect(records.filter((record) => ["expense", "income", "budget"].includes(record.kind))).toEqual([]);
  });
});

describe("the activity's lines, kept apart", () => {
  it("lists the month's purchases and sales of parcels to resell, the latest first, not mine", () => {
    expect(activityLines([], sources, "2026-10").map(({ flow, item }) => [flow, item.key, item.amountMga])).toEqual([
      ["income", saleKey("shoes"), 50000],
      ["income", saleKey("dress"), 130000],
      ["expense", costKey("bag"), 80000],
      ["expense", costKey("dress"), 80000],
      ["expense", costKey("shoes"), 40000],
    ]);
  });

  it("picks a line's pocket by its key, like the month's lines", () => {
    const other: Wallet = { ...wallet, id: "mvola", name: "MVola", type: "mvola", primary: false };
    const records: ExpenseRecord[] = [wallet, other, setting(true), { ...base, kind: "walletPick", id: "walletPick:sale:dress", sourceKey: saleKey("dress"), wallet: "mvola" }];
    const book = walletBook(records, sources, now);
    expect(book.balances.get("mvola")).toBe(500000 + 130000);
  });

  it("'don't count' leaves a sale out of the profit, and a cost out of what is taken from it", () => {
    const outSale = [exclusion(saleKey("shoes"))];
    expect(activityLines(outSale, sources, "2026-10").find(({ item }) => item.key === saleKey("shoes"))?.item.excluded).toBe(true);
    expect(monthIncomes(outSale, "2026-10", budgetSources(sources, true, excludedKeys(outSale)))[0].amountMga).toBe(50000);
    expect(activityMonth(parcels, "2026-10", excludedKeys(outSale))).toMatchObject({ sold: 1, salesMga: 130000, profitMga: 50000 });

    const outCost = [exclusion(costKey("dress"))];
    expect(monthIncomes(outCost, "2026-10", budgetSources(sources, true, excludedKeys(outCost)))[0].amountMga).toBe(140000);
    expect(activityMonth(parcels, "2026-10", excludedKeys(outCost))).toMatchObject({ bought: 2, boughtMga: 120000, profitMga: 140000, stockMga: 80000 });
  });
});

describe("Mon activité", () => {
  it("adds up the month's purchases, sales, profit, what is owed, the stock and the best clients", () => {
    expect(activityMonth(parcels, "2026-10")).toEqual({
      active: true,
      bought: 3,
      boughtMga: 200000,
      sold: 2,
      salesMga: 180000,
      profitMga: 60000,
      toCollectMga: 30000,
      stock: 1,
      stockMga: 80000,
      topClients: [
        { name: "Rado", salesMga: 130000, profitMga: 50000, parcels: 1 },
        { name: "Vola", salesMga: 50000, profitMga: 10000, parcels: 1 },
      ],
    });
  });

  it("is not shown without a parcel to resell, and keeps 3 clients at most", () => {
    expect(activityMonth([parcel("case")], "2026-10").active).toBe(false);
    const many = ["A", "B", "C", "D"].map((name, index) => parcel(name, { client: name, salePriceMga: 100000 + index * 10000, soldAt: day(2026, 10, 5) }));
    expect(activityMonth(many, "2026-10").topClients.map((client) => client.name)).toEqual(["D", "C", "B"]);
    expect(activityMonth(many, "2026-11")).toMatchObject({ sold: 0, salesMga: 0, bought: 0, stock: 0, toCollectMga: 400000 + 60000 });
  });
});

describe("deleting a savings goal or a tontine", () => {
  const goal: SavingsGoal = { ...base, kind: "savingsGoal", id: "g", name: "Rentrée scolaire", targetMga: 300000, deposits: [{ id: "d", at: start, amountMga: 120000 }] };
  const tontine: Tontine = { ...base, kind: "tontine", id: "t", name: "Quartier", amountMga: 20000, frequency: "monthly", members: 5, startAt: start, myTurn: 3, remind: false, deposits: [{ id: "d", at: start, amountMga: 40000 }] };

  it("says what comes back to the pockets", () => {
    expect(removalEffect(goal)).toEqual({ kind: "held", amountMga: 120000 });
    expect(removalEffect({ ...goal, deposits: [] })).toEqual({ kind: "nothing" });
    expect(removalEffect(tontine)).toEqual({ kind: "held", amountMga: 40000 });
    expect(removalEffect({ ...tontine, received: { at: start, amountMga: 100000 } })).toEqual({ kind: "pot" });
  });
});
