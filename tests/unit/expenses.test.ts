import "fake-indexeddb/auto";
import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";
import fr from "@/locales/fr.json";
import { categoryRecap, expenseRows, expensesWorkbook, monthFigures, overallCap } from "@/lib/expenseExport";
import {
  budgetLevel,
  budgetLines,
  compareMonths,
  exclusionId,
  lastMonths,
  monthExpenses,
  monthIncomes,
  monthKey,
  monthTotals,
  newBudgetAlerts,
  nextDueReminder,
  occurrenceIn,
  occurrenceKey,
  shiftMonth,
  sourceItems,
  spendingHistory,
  toAriary,
  type Exclusion,
  type ExpenseRecord,
  type Income,
  type ManualExpense,
  type Recurring,
} from "@/lib/expenses";
import { hasFeature, planFor } from "@/lib/plans";
import { RESTORE_KEYS } from "@/scripts/lib/backup.mjs";
import { plannedExpenseReminders, reconcileExpenseReminderState, type ScheduledExpenseReminders } from "@/services/expenseReminders";
import { expenseStore } from "@/services/expenseStore";
import { tapTarget } from "@/services/notificationTap";

const t = (key: string) => key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], fr) as string;
const day = (year: number, month: number, date: number, hour = 12) => new Date(year, month - 1, date, hour).getTime();
const base = { createdAt: 1, updatedAt: 1 };

const expense = (id: string, at: number, amountMga: number, patch: Partial<ManualExpense> = {}): ManualExpense => ({ ...base, kind: "expense", id, at, amountMga, category: "market", ...patch });
const recurring = (id: string, patch: Partial<Recurring> = {}): Recurring => ({
  ...base,
  kind: "recurring",
  id,
  flow: "expense",
  label: "Loyer",
  amountMga: 300000,
  category: "rent",
  day: 5,
  startMonth: "2026-09",
  remind: "none",
  skipped: [],
  ...patch,
});
const exclusion = (sourceKey: string): Exclusion => ({ ...base, kind: "exclusion", id: exclusionId(sourceKey), sourceKey });

describe("months", () => {
  it("names and shifts months in local time", () => {
    expect(monthKey(day(2026, 10, 31, 23))).toBe("2026-10");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(lastMonths("2026-02", 3)).toEqual(["2025-12", "2026-01", "2026-02"]);
  });
});

describe("recurring", () => {
  it("falls on its day each month, a 31st on the last day of shorter months, without drifting", () => {
    const rule = recurring("r", { day: 31, startMonth: "2026-11" });
    expect(new Date(occurrenceIn(rule, "2026-11")!).getDate()).toBe(30);
    expect(new Date(occurrenceIn(rule, "2026-12")!).getDate()).toBe(31);
    expect(new Date(occurrenceIn(rule, "2027-02")!).getDate()).toBe(28);
    expect(new Date(occurrenceIn(rule, "2027-03")!).getDate()).toBe(31);
    expect(new Date(occurrenceIn(rule, "2026-12")!).getHours()).toBe(9);
  });

  it("counts only between its first and last month", () => {
    const rule = recurring("r", { startMonth: "2026-09", endMonth: "2026-11" });
    expect(occurrenceIn(rule, "2026-08")).toBeNull();
    expect(occurrenceIn(rule, "2026-09")).toBe(day(2026, 9, 5, 9));
    expect(occurrenceIn(rule, "2026-12")).toBeNull();
  });

  it("shows up every month unless skipped, and a manual expense can stand for one occurrence", () => {
    const rule = recurring("rent");
    expect(monthExpenses([rule], [], "2026-10").map((item) => item.amountMga)).toEqual([300000]);
    expect(monthExpenses([{ ...rule, skipped: ["2026-10"] }], [], "2026-10")).toEqual([]);
    const corrected = expense("m", day(2026, 10, 6), 280000, { category: "rent", sourceKey: occurrenceKey("rent", "2026-10") });
    const items = monthExpenses([rule, corrected], [], "2026-10");
    expect(items.map((item) => [item.origin, item.amountMga])).toEqual([["manual", 280000]]);
    // Next month, the rule is back as it is.
    expect(monthExpenses([rule, corrected], [], "2026-11").map((item) => item.amountMga)).toEqual([300000]);
  });

  it("adds recurring incomes to the month's incomes", () => {
    const salary = recurring("salary", { flow: "income", category: "salary", amountMga: 900000, label: "Salaire" });
    const extra: Income = { ...base, kind: "income", id: "i", at: day(2026, 10, 12), amountMga: 50000, income: "sales" };
    const incomes = monthIncomes([salary, extra], "2026-10");
    expect(incomes.map((item) => [item.income, item.amountMga])).toEqual([
      ["sales", 50000],
      ["salary", 900000],
    ]);
    // An income never counts as an expense.
    expect(monthExpenses([salary], [], "2026-10")).toEqual([]);
  });
});

describe("what the app already knows", () => {
  const sources = sourceItems({
    bills: [
      { entry: { id: "scan-1" }, kind: "electricity_water", issuer: "JIRAMA", amountMga: 45000, paidAt: day(2026, 10, 3) },
      // Not paid yet: not an expense.
      { entry: { id: "scan-2" }, kind: "phone_internet", issuer: "Telma", amountMga: 20000, paidAt: null },
    ],
    lists: [
      {
        id: "l1",
        title: "Courses",
        kind: "shopping",
        updatedAt: day(2026, 10, 8),
        items: [
          { id: "a", text: "Riz", done: true, priceMga: 30000 },
          { id: "b", text: "Huile", done: false, priceMga: 9000 },
        ],
      },
      { id: "l2", title: "À faire", kind: "todo", updatedAt: day(2026, 10, 8), items: [{ id: "c", text: "x", done: true, priceMga: 5 }] },
    ],
    parcels: [{ id: "p1", title: "Casque", priceMga: 100000, fees: [{ id: "f", label: "Fret", amountMga: 20000 }], createdAt: day(2026, 10, 2) }],
    vehicles: [
      {
        id: "v1",
        name: "La Corolla",
        fuel: [{ id: "f1", at: day(2026, 10, 4), km: 1000, litres: 30, amountMga: 150000, full: true }],
        maintenance: [{ id: "m1", at: day(2026, 9, 20), kind: "oil", costMga: 80000 }],
        expenses: [{ id: "e1", at: day(2026, 10, 10), kind: "insurance", amountMga: 200000 }],
      },
    ],
  });

  it("reads paid bills, ticked shopping, parcel costs and the garage, each with its source", () => {
    const items = monthExpenses([], sources, "2026-10");
    expect(items.map((item) => [item.origin, item.amountMga, item.category])).toEqual([
      ["vehicle", 200000, "car"],
      ["shopping", 30000, "market"],
      ["fuel", 150000, "transport"],
      ["bill", 45000, "jirama"],
      ["parcel", 120000, "online"],
    ]);
    expect(items.find((item) => item.origin === "bill")?.href).toBe("/result?id=scan-1");
    expect(monthExpenses([], sources, "2026-09").map((item) => item.origin)).toEqual(["maintenance"]);
  });

  it("never counts twice: a manual expense linked to a source replaces it, an exclusion leaves it out", () => {
    const linked = expense("m", day(2026, 10, 3), 46000, { category: "jirama", sourceKey: "bill:scan-1" });
    const items = monthExpenses([linked, exclusion("parcel:p1")], sources, "2026-10");
    expect(items.filter((item) => item.key === "bill:scan-1")).toEqual([]);
    expect(items.find((item) => item.key === "parcel:p1")?.excluded).toBe(true);
    // 200 000 + 30 000 + 150 000 + 46 000; the parcel is shown but not counted.
    expect(monthTotals(items).total).toBe(426000);
  });
});

describe("totals", () => {
  it("adds up by category, the largest first, and compares with last month", () => {
    const items = monthExpenses(
      [expense("a", day(2026, 10, 1), 10000), expense("b", day(2026, 10, 2), 25000, { category: "transport" }), expense("c", day(2026, 10, 3), 5000)],
      [],
      "2026-10",
    );
    expect(monthTotals(items)).toEqual({
      total: 40000,
      byCategory: [
        { category: "transport", amount: 25000 },
        { category: "market", amount: 15000 },
      ],
    });
    expect(compareMonths(40000, 32000)).toEqual({ difference: 8000, percent: 25 });
    expect(compareMonths(40000, 0).percent).toBeNull();
  });

  it("gives the history over 6 months and the average per category", () => {
    const records: ExpenseRecord[] = [expense("a", day(2026, 10, 1), 60000), expense("b", day(2026, 5, 1), 999999), expense("c", day(2026, 8, 1), 30000, { category: "health" })];
    const history = spendingHistory(records, [], "2026-10", 6);
    expect(history.months.map((item) => item.month)).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(history.months[0].total).toBe(999999);
    const three = spendingHistory(records, [], "2026-10", 3);
    expect(three.average).toBe(30000);
    expect(three.averages).toEqual([
      { category: "market", amount: 20000 },
      { category: "health", amount: 10000 },
    ]);
  });
});

describe("budget", () => {
  it("warns at 80 % and is over beyond the cap", () => {
    expect(budgetLevel(79, 100)).toBe("ok");
    expect(budgetLevel(80, 100)).toBe("warning");
    expect(budgetLevel(100, 100)).toBe("warning");
    expect(budgetLevel(101, 100)).toBe("over");
    expect(budgetLevel(500, undefined)).toBeNull();
  });

  it("checks the overall cap and each category's", () => {
    const totals = { total: 90000, byCategory: [{ category: "market", amount: 60000 }] };
    const lines = budgetLines({ total: 100000, categories: { market: 50000, health: 20000 } }, totals);
    expect(lines.map((line) => [line.scope, line.level])).toEqual([
      ["total", "warning"],
      ["market", "over"],
      ["health", "ok"],
    ]);
  });

  it("notifies each level once: 80 %, then over", () => {
    const lines = budgetLines({ total: 100000, categories: {} }, { total: 85000, byCategory: [] });
    expect(newBudgetAlerts(lines, {}).map((line) => line.level)).toEqual(["warning"]);
    expect(newBudgetAlerts(lines, { total: "warning" })).toEqual([]);
    const over = budgetLines({ total: 100000, categories: {} }, { total: 120000, byCategory: [] });
    expect(newBudgetAlerts(over, { total: "warning" }).map((line) => line.level)).toEqual(["over"]);
  });
});

describe("currencies", () => {
  it("converts to ariary at the rate, rounded", () => {
    expect(toAriary(12.5, 4890.4)).toBe(61130);
  });

  it("keeps the amount as typed, its currency and the rate", async () => {
    await expenseStore.wipe();
    const saved = await expenseStore.saveExpense({ at: day(2026, 10, 1), amountMga: 61130, category: "online", currency: "USD", originalAmount: 12.5, rate: 4890.4 });
    expect(saved).toMatchObject({ kind: "expense", amountMga: 61130, currency: "USD", originalAmount: 12.5, rate: 4890.4 });
  });
});

describe("store", () => {
  beforeEach(() => expenseStore.wipe());

  it("saves expenses, the budget, categories, exclusions and skipped months", async () => {
    expect(await expenseStore.saveExpense({ at: 1, amountMga: 0, category: "market" })).toBeNull();
    const kept = await expenseStore.saveExpense({ at: 1, amountMga: 1234.4, category: "market", note: "  Tsena  " });
    expect(kept).toMatchObject({ amountMga: 1234, note: "Tsena" });
    await expenseStore.setBudget(500000, { market: 200000, health: undefined });
    await expenseStore.setExcluded("bill:x", true);
    const rule = await expenseStore.saveRecurring({ flow: "expense", label: "Loyer", amountMga: 300000, category: "rent", day: 40, startMonth: "2026-10", remind: "eve", skipped: [] });
    expect(rule?.day).toBe(31);
    await expenseStore.setSkipped(rule!.id, "2026-11", true);
    const all = await expenseStore.list();
    expect(all.find((record) => record.kind === "budget")).toMatchObject({ total: 500000, categories: { market: 200000 } });
    expect(all.find((record) => record.kind === "exclusion")).toMatchObject({ sourceKey: "bill:x" });
    expect(all.find((record) => record.kind === "recurring")).toMatchObject({ skipped: ["2026-11"] });
    await expenseStore.setExcluded("bill:x", false);
    expect((await expenseStore.list()).some((record) => record.kind === "exclusion")).toBe(false);
  });
});

describe("due reminders", () => {
  const rule = recurring("rent", { remind: "eve", startMonth: "2026-10" });

  it("rings the day before at 9:00, skipping months marked or replaced", () => {
    expect(nextDueReminder(rule, [rule], day(2026, 10, 1))?.at).toBe(day(2026, 10, 4, 9));
    // Past this month's: next month's.
    expect(nextDueReminder(rule, [rule], day(2026, 10, 4, 10))?.month).toBe("2026-11");
    const skipped = { ...rule, skipped: ["2026-10"] };
    expect(nextDueReminder(skipped, [skipped], day(2026, 10, 1))?.month).toBe("2026-11");
    const paid = expense("m", day(2026, 10, 2), 300000, { sourceKey: occurrenceKey("rent", "2026-10") });
    expect(nextDueReminder(rule, [rule, paid], day(2026, 10, 1))?.month).toBe("2026-11");
    expect(nextDueReminder({ ...rule, remind: "day" }, [rule], day(2026, 10, 1))?.at).toBe(day(2026, 10, 5, 9));
    expect(nextDueReminder({ ...rule, remind: "none" }, [rule], day(2026, 10, 1))).toBeNull();
  });

  it("schedules them only with the plan, and cancels them without", async () => {
    expect(plannedExpenseReminders([rule], day(2026, 10, 1), false).size).toBe(0);
    let saved: ScheduledExpenseReminders = { rent: { id: 7, at: 1, text: "old" } };
    const cancelled: number[] = [];
    const scheduled: Array<{ at: Date; entryId: string }> = [];
    const deps = {
      permission: async () => "granted",
      notify: async (options: { at: Date; entryId: string }) => {
        scheduled.push(options);
        return 42;
      },
      cancel: async (id: number) => {
        cancelled.push(id);
      },
      pending: async () => null,
      load: () => saved,
      save: (next: ScheduledExpenseReminders) => {
        saved = next;
      },
    };
    const texts = () => ({ title: "Loyer", body: "300 000 Ar" });
    await reconcileExpenseReminderState([rule], texts, deps, { now: day(2026, 10, 1) });
    expect(cancelled).toEqual([7]);
    expect(scheduled.map((item) => [item.at.getTime(), item.entryId])).toEqual([[day(2026, 10, 4, 9), "expense:rent"]]);
    await reconcileExpenseReminderState([rule], texts, deps, { now: day(2026, 10, 1), enabled: false });
    expect(cancelled).toEqual([7, 42]);
    expect(saved).toEqual({});
    expect(tapTarget("expense:rent")).toEqual({ pathname: "/expenses" });
  });
});

describe("export", () => {
  const items = monthExpenses(
    [expense("a", day(2026, 10, 2), 61130, { category: "online", note: "Temu", payment: "card", currency: "USD", originalAmount: 12.5, rate: 4890.4 }), exclusion("bill:scan-1")],
    sourceItems({ bills: [{ entry: { id: "scan-1" }, kind: "electricity_water", issuer: "JIRAMA", amountMga: 45000, paidAt: day(2026, 10, 1) }] }),
    "2026-10",
  );
  const categoryName = (category: string) => t(`expenses.categories.${category}`);

  it("gives one row per line, the oldest first, with origin, payment, original amount and whether it counts", () => {
    expect(expenseRows({ items, categoryName }, t).map(({ category, origin, payment, original, amountMga, counted }) => ({ category, origin, payment, original, amountMga, counted }))).toEqual([
      { category: "JIRAMA", origin: "Facture", payment: "", original: "", amountMga: 45000, counted: "Non" },
      { category: "Achats en ligne et colis", origin: "Saisie", payment: "Carte", original: "12.5 USD (4890.4)", amountMga: 61130, counted: "Oui" },
    ]);
    expect(categoryRecap({ items, budget: [], categoryName })).toEqual([{ category: "Achats en ligne et colis", spent: 61130, cap: null }]);
    expect(monthFigures({ items, incomes: [] })).toEqual({ spent: 61130, earned: 0, left: -61130 });
  });

  it("writes an Excel workbook: the expenses with a total, then a sheet per category", async () => {
    const bytes = await expensesWorkbook({ month: "2026-10", items, incomes: [], budget: [], categoryName }, t, { title: "Mes dépenses · octobre 2026", subtitle: "Exporté le 27 oct. 2026" });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes);
    const sheet = book.getWorksheet("Dépenses")!;
    expect(sheet.getCell("A1").value).toBe("Mes dépenses · octobre 2026");
    expect(sheet.getRow(4).values).toContain("Montant");
    expect(sheet.getCell("G6").value).toBe(61130);
    expect(sheet.getCell("G6").numFmt).toBe('#,##0" Ar"');
    expect(sheet.getCell("A7").value).toBe("Total");
    expect(book.getWorksheet("Par catégorie")!.getCell("A5").value).toBe("Achats en ligne et colis");
  });

  it("puts each category's budget in the recap, and the overall budget on its Total line", async () => {
    const budget = budgetLines({ total: 500000, categories: { online: 100000, jirama: 50000 } }, monthTotals(items));
    expect(overallCap(budget)).toBe(500000);
    expect(overallCap(budget.filter((line) => line.scope !== "total"))).toBe(150000);
    expect(overallCap([])).toBeNull();
    const bytes = await expensesWorkbook({ month: "2026-10", items, incomes: [], budget, categoryName }, t, { title: "Mes dépenses · octobre 2026", subtitle: "" });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes);
    const recap = book.getWorksheet("Par catégorie")!;
    expect([recap.getCell("A5").value, recap.getCell("B5").value, recap.getCell("C5").value]).toEqual(["Achats en ligne et colis", 61130, 100000]);
    // The bill is out of the budget: nothing spent, its cap still shown.
    expect([recap.getCell("A6").value, recap.getCell("B6").value, recap.getCell("C6").value]).toEqual(["JIRAMA", 0, 50000]);
    expect(recap.getCell("A7").value).toBe("Total");
    expect((recap.getCell("C7").value as { result: number }).result).toBe(500000);
    expect(recap.getCell("C7").numFmt).toBe('#,##0" Ar"');
  });
});

describe("plan and backups", () => {
  it("is for the Admin plan only while tested", () => {
    expect(planFor("expenses")).toBe("unlimited");
    expect(hasFeature("pro", "expenses")).toBe(false);
    expect(hasFeature("unlimited", "expenses")).toBe(true);
  });

  it("backs up the expenses table", () => {
    expect(RESTORE_KEYS.expenses).toEqual(["user_id", "id"]);
  });
});
