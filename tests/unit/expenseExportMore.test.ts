import "fake-indexeddb/auto";
import ExcelJS from "exceljs";
import type { NextApiRequest, NextApiResponse } from "next";
import { describe, expect, it, vi } from "vitest";
import fr from "@/locales/fr.json";
import { mockExpenseSummary } from "@/lib/ai/mock";
import { buildSummaryPrompt } from "@/lib/ai/prompt";
import { ExpenseSummaryRequestSchema } from "@/lib/ai/schema";
import { withSavingsDemo } from "@/lib/ai/summaryDemo";
import { reviewExtras, summaryRequest } from "@/lib/expenseAi";
import { expenseRows, expensesWorkbook, incomeRows, pdfMoreSections, pocketMonths, pocketTotals, savingsMonth } from "@/lib/expenseExport";
import { monthExpenses, monthIncomes, type ExpenseRecord, type Income, type ManualExpense, type SavingsGoal, type Tontine, type Transfer, type Wallet } from "@/lib/expenses";
import type { ActivityMonth } from "@/lib/resale";
import { walletBook } from "@/lib/wallets";

// The month's review route in demo mode (no AI key), for the old and new bodies.
vi.mock("@/lib/server/redis", () => ({ redis: null }));
vi.mock("@/lib/ai/provider", () => ({ activeProvider: "demo", summarizeExpenses: async () => ({}) }));
const { default: summaryRoute } = await import("@/pages/api/expenses/summary");

// "t" over the French texts, like the app's.
const t = (key: string, params: Record<string, string | number> = {}) => {
  const text = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], fr);
  return typeof text === "string" ? text.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`)) : key;
};

const day = (year: number, month: number, date: number, hour = 12) => new Date(year, month - 1, date, hour).getTime();
const start = day(2026, 10, 1, 8);
const base = { createdAt: start, updatedAt: start };
const now = day(2026, 11, 15, 18);

const wallet = (id: string, name: string, type: Wallet["type"], startMga: number, patch: Partial<Wallet> = {}): Wallet => ({ ...base, kind: "wallet", id, name, type, startMga, startAt: start, ...patch });
const expense = (id: string, at: number, amountMga: number, patch: Partial<ManualExpense> = {}): ManualExpense => ({ ...base, createdAt: at, kind: "expense", id, at, amountMga, category: "market", ...patch });
const income = (id: string, at: number, amountMga: number, patch: Partial<Income> = {}): Income => ({ ...base, createdAt: at, kind: "income", id, at, amountMga, income: "salary", ...patch });
const transfer: Transfer = { ...base, kind: "transfer", id: "tr", from: "cash", to: "mvola", at: day(2026, 10, 12), amountMga: 5000 };
const goal: SavingsGoal = {
  ...base,
  kind: "savingsGoal",
  id: "g1",
  name: "Rentrée de Fara",
  targetMga: 300000,
  deposits: [{ id: "d1", at: day(2026, 10, 10), amountMga: 30000, wallet: "cash" }],
};
const tontine: Tontine = {
  ...base,
  kind: "tontine",
  id: "t1",
  name: "Tontine de Mme Rasoa",
  amountMga: 20000,
  frequency: "monthly",
  members: 12,
  startAt: new Date(2026, 9, 5).getTime(),
  myTurn: 3,
  deposits: [{ id: "p1", at: day(2026, 10, 5), amountMga: 20000, wallet: "mvola" }],
  remind: false,
};

// Cash: 100 000, −10 000 market, −30 000 set aside, −5 000 to MVola; −3 000 in November.
// MVola: 50 000, +200 000 salary, −20 000 tontine, +5 000 from cash.
const records: ExpenseRecord[] = [
  wallet("cash", "Espèces de Fara", "cash", 100000, { primary: true }),
  wallet("mvola", "MVola", "mvola", 50000),
  expense("e1", day(2026, 10, 3), 10000, { wallet: "cash", note: "Marché Analakely" }),
  expense("e2", day(2026, 11, 2), 3000, { wallet: "cash" }),
  income("i1", day(2026, 10, 1, 9), 200000, { wallet: "mvola" }),
  transfer,
  goal,
  tontine,
];
const book = walletBook(records, [], now);
const items = monthExpenses(records, [], "2026-10");
const incomes = monthIncomes(records, "2026-10", []);
const categoryName = (category: string) => t(`expenses.categories.${category}`);
const activity: ActivityMonth = { active: true, bought: 2, boughtMga: 130000, sold: 1, salesMga: 130000, profitMga: 50000, toCollectMga: 30000, stock: 1, stockMga: 50000, topClients: [] };
const heading = { title: "Mes dépenses · octobre 2026", subtitle: "" };

async function workbookOf(data: Partial<Parameters<typeof expensesWorkbook>[0]>) {
  const bytes = await expensesWorkbook({ month: "2026-10", items, incomes, budget: [], categoryName, ...data }, t, heading);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  return workbook;
}

describe("the pockets over a month", () => {
  it("reads back each pocket's balance at the start and the end, with its incomes, expenses and moves", () => {
    expect(pocketMonths(book, "2026-10")).toEqual([
      { name: "Espèces de Fara", start: 100000, incomes: 0, expenses: 10000, moves: -35000, end: 55000 },
      { name: "MVola", start: 50000, incomes: 200000, expenses: 0, moves: -15000, end: 235000 },
    ]);
    // November starts where October ended.
    expect(pocketTotals(book, "2026-11")).toEqual({ start: 290000, end: 287000 });
    expect(pocketTotals(book, "2026-10")).toEqual({ start: 150000, end: 290000 });
  });

  it("leaves out a pocket set after the month, and has nothing without pockets", () => {
    expect(pocketMonths(book, "2026-09")).toEqual([]);
    expect(pocketTotals(walletBook([], [], now), "2026-10")).toBeNull();
  });
});

describe("the money set aside over a month", () => {
  it("gives the goals, the tontines and the month's movements", () => {
    const savings = savingsMonth(records, "2026-10", book);
    expect(savings.goals).toEqual([{ name: "Rentrée de Fara", target: 300000, saved: 30000, left: 270000, month: 30000 }]);
    expect(savings.tontines).toEqual([{ name: "Tontine de Mme Rasoa", paid: 20000, pot: 240000, received: false, potAt: new Date(2026, 11, 5).getTime(), month: 20000 }]);
    expect(savings.moves.map(({ name, type, wallet: pocket, amountMga }) => ({ name, type, pocket, amountMga }))).toEqual([
      { name: "Tontine de Mme Rasoa", type: "paid", pocket: "MVola", amountMga: 20000 },
      { name: "Rentrée de Fara", type: "saved", pocket: "Espèces de Fara", amountMga: 30000 },
    ]);
    expect(savingsMonth(records, "2026-11").moves).toEqual([]);
  });
});

describe("the export with pockets, savings and activity", () => {
  it("adds the Pocket column to the expenses and the incomes, only once there are pockets", () => {
    expect(expenseRows({ items, categoryName, book }, t).map((row) => row.wallet)).toEqual(["Espèces de Fara"]);
    expect(incomeRows({ incomes, book }, t).map((row) => row.wallet)).toEqual(["MVola"]);
    expect(expenseRows({ items, categoryName }, t).map((row) => row.wallet)).toEqual([""]);
  });

  it("writes the pockets, the savings and the activity sheets, with the Pocket column", async () => {
    const workbook = await workbookOf({ book, records, activity });
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Dépenses", "Par catégorie", "Revenus", "Mes poches", "Épargne et tontines", "Mon activité"]);
    const expenses = workbook.getWorksheet("Dépenses")!;
    expect(expenses.getRow(4).values).toContain("Poche");
    expect(expenses.getCell("F5").value).toBe("Espèces de Fara");
    expect(expenses.getCell("H5").value).toBe(10000);
    expect(workbook.getWorksheet("Revenus")!.getRow(4).values).toContain("Poche");

    const pockets = workbook.getWorksheet("Mes poches")!;
    expect(pockets.getRow(4).values).toEqual([undefined, "Poche", "Début du mois", "Entrées", "Sorties", "Virements", "Fin du mois"]);
    expect(pockets.getRow(5).values).toEqual([undefined, "Espèces de Fara", 100000, 0, 10000, -35000, 55000]);
    expect(pockets.getCell("A7").value).toBe("Dans tes poches");
    expect((pockets.getCell("F7").value as { result: number }).result).toBe(290000);
    expect(pockets.getCell("F7").numFmt).toBe('#,##0" Ar"');

    const savings = workbook.getWorksheet("Épargne et tontines")!;
    expect(savings.getCell("A4").value).toBe("Mes objectifs");
    expect(savings.getRow(6).values).toEqual([undefined, "Rentrée de Fara", 300000, 30000, 270000, 30000]);
    expect(savings.getCell("A9").value).toBe("Mes tontines");
    expect(savings.getCell("D11").value).toBe("À venir");

    const sheet = workbook.getWorksheet("Mon activité")!;
    expect(sheet.getRow(7).values).toEqual([undefined, "Bénéfice", 50000, ""]);
  });

  it("leaves out the parts that are empty, as before", async () => {
    const workbook = await workbookOf({ book: walletBook([], [], now), records: [], activity: null, incomes: [] });
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Dépenses", "Par catégorie"]);
    expect(workbook.getWorksheet("Dépenses")!.getRow(4).values).not.toContain("Poche");
    const inactive = await workbookOf({ activity: { ...activity, active: false } });
    expect(inactive.worksheets.map((sheet) => sheet.name)).not.toContain("Mon activité");
  });

  it("gives the PDF its sections, the empty ones left out", () => {
    const money = (value: number) => `${value} Ar`;
    const sections = pdfMoreSections({ month: "2026-10", items, incomes, budget: [], categoryName, book, records, activity }, t, "fr", money);
    expect(sections.map((section) => section.heading)).toEqual(["Mes poches", "Épargne et tontines", "Mon activité"]);
    expect(sections[0].bullets?.[0]).toBe("Espèces de Fara · début 100000 Ar · entrées 0 Ar · sorties −10000 Ar · virements −35000 Ar · fin 55000 Ar");
    expect(sections[0].pairs).toEqual([{ label: "Dans tes poches", value: "150000 Ar → 290000 Ar" }]);
    expect(sections[1].more?.bullets).toHaveLength(2);
    expect(pdfMoreSections({ month: "2026-10", items, incomes, budget: [], categoryName }, t, "fr", money)).toEqual([]);
  });
});

describe("the month's review with the pockets and the savings", () => {
  const input = summaryRequest(records, [], "2026-10", { locale: "fr", now, categoryName }, { book, activity });

  it("sends the totals, never a name", () => {
    expect(input).toMatchObject({ pocketsStart: 150000, pocketsEnd: 290000, savedThisMonth: 30000, tontinePaid: 20000, activityProfit: 50000 });
    const sent = JSON.stringify(input);
    for (const secret of ["Fara", "Rasoa", "MVola", "Analakely"]) expect(sent).not.toContain(secret);
    expect(ExpenseSummaryRequestSchema.safeParse(input).success).toBe(true);
    expect(buildSummaryPrompt(input)).toContain('"savedThisMonth":30000');
  });

  it("leaves the new totals out when there is nothing to say", () => {
    const old = summaryRequest([], [], "2026-10", { locale: "fr", now, categoryName });
    expect(Object.keys(old)).not.toContain("pocketsStart");
    expect(reviewExtras([], undefined, "2026-10", null)).toEqual({});
    expect(reviewExtras(records, book, "2026-10", { ...activity, active: false })).not.toHaveProperty("activityProfit");
  });

  it("accepts an older app's body, and still refuses anything more than totals", () => {
    const old = summaryRequest([], [], "2026-10", { locale: "fr", now, categoryName });
    expect(ExpenseSummaryRequestSchema.safeParse(old).success).toBe(true);
    expect(ExpenseSummaryRequestSchema.safeParse({ ...input, pocketNames: ["MVola"] }).success).toBe(false);
    expect(ExpenseSummaryRequestSchema.safeParse({ ...input, tontinePaid: -1 }).success).toBe(false);
  });

  it("has a demo review that speaks of the money set aside", () => {
    const demo = withSavingsDemo(mockExpenseSummary(input), input);
    expect(demo.findings.find((finding) => /^Tu as mis 30\s000 Ar de côté et versé 20\s000 Ar à ta tontine ce mois-ci, bravo\.$/.test(finding))).toBeDefined();
    expect(demo.findings.length).toBeLessThanOrEqual(5);
    const old = summaryRequest([], [], "2026-10", { locale: "fr", now, categoryName });
    expect(withSavingsDemo(mockExpenseSummary(old), old)).toEqual(mockExpenseSummary(old));
  });

  async function call(payload: unknown) {
    const req = { method: "POST", headers: {}, body: payload, socket: { remoteAddress: `10.2.0.${Math.floor(Math.random() * 250)}` } } as unknown as NextApiRequest;
    const res = {
      statusCode: 200,
      body: undefined as unknown,
      writableEnded: false,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(value: unknown) {
        this.body = value;
        this.writableEnded = true;
        return this;
      },
      setHeader() {},
      end() {},
      on() {},
    };
    await summaryRoute(req, res as unknown as NextApiResponse);
    return res as { statusCode: number; body: { summary?: { findings: string[] }; demo?: boolean } };
  }

  it("is answered by the route for an old body and a new one (demo)", async () => {
    const old = await call(summaryRequest([], [], "2026-10", { locale: "fr", now, categoryName }));
    expect(old.statusCode).toBe(200);
    expect(old.body.summary?.findings.some((finding) => finding.includes("de côté"))).toBe(false);
    const fresh = await call(input);
    expect(fresh.statusCode).toBe(200);
    expect(fresh.body.summary?.findings.some((finding) => finding.includes("de côté"))).toBe(true);
  });
});
