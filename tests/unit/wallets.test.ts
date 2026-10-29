import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { mockReceipt } from "@/lib/ai/mock";
import { AnalysisSchema, normalizeStoredAnalysis, type Analysis } from "@/lib/ai/schema";
import {
  arrivalKey,
  byKind,
  exclusionId,
  hasOwnExpenses,
  keepKey,
  monthBalance,
  monthExpenses,
  monthIncomes,
  receiptKey,
  sourceItems,
  transferFeesKey,
  walletPickId,
  type Correction,
  type Exclusion,
  type ExpenseRecord,
  type Income,
  type ManualExpense,
  type ReceiptScan,
  type Transfer,
  type Wallet,
  type WalletPick,
} from "@/lib/expenses";
import { correctionFor, countsOn, lineWallet, pendingMoves, primaryWallet, walletBook, walletContext, walletForPayment } from "@/lib/wallets";
import { expenseStore } from "@/services/expenseStore";

const day = (year: number, month: number, date: number, hour = 12) => new Date(year, month - 1, date, hour).getTime();
const midnight = (year: number, month: number, date: number) => new Date(year, month - 1, date).getTime();
const start = day(2026, 10, 1, 8);
const now = day(2026, 10, 29, 18);
const base = { createdAt: start, updatedAt: start };

const wallet = (id: string, type: Wallet["type"], startMga: number, patch: Partial<Wallet> = {}): Wallet => ({ ...base, kind: "wallet", id, name: id, type, startMga, startAt: start, ...patch });
const expense = (id: string, at: number, amountMga: number, patch: Partial<ManualExpense> = {}): ManualExpense => ({ ...base, createdAt: at, kind: "expense", id, at, amountMga, category: "market", ...patch });
const income = (id: string, at: number, amountMga: number, patch: Partial<Income> = {}): Income => ({ ...base, createdAt: at, kind: "income", id, at, amountMga, income: "salary", ...patch });
const transfer = (id: string, from: string, to: string, amountMga: number, patch: Partial<Transfer> = {}): Transfer => ({ ...base, kind: "transfer", id, from, to, at: day(2026, 10, 10), amountMga, ...patch });
const correction = (id: string, walletId: string, amountMga: number): Correction => ({ ...base, kind: "correction", id, wallet: walletId, at: day(2026, 10, 20), amountMga });
const pick = (sourceKey: string, walletId: string): WalletPick => ({ ...base, kind: "walletPick", id: walletPickId(sourceKey), sourceKey, wallet: walletId });
const exclusion = (sourceKey: string): Exclusion => ({ ...base, kind: "exclusion", id: exclusionId(sourceKey), sourceKey });

type Receipt = NonNullable<NonNullable<Analysis["document"]>["receipt"]>;
const scan = (id: string, receipt: Partial<Receipt>, direction: "out" | "in" | "own" = "out", createdAt = day(2026, 10, 25)): ReceiptScan => {
  const demo = mockReceipt("fr", direction);
  return { id, createdAt, analysis: { document: { ...demo.document!, receipt: { ...demo.document!.receipt!, date: "2026-10-25", ...receipt } } } };
};

const pockets = [wallet("cash", "cash", 45000), wallet("mvola", "mvola", 230000), wallet("bank", "bank", 500000)];
const balances = (records: ExpenseRecord[], sources = sourceItems({})) => Object.fromEntries(walletBook(records, sources, now).balances);

describe("a pocket's balance", () => {
  it("starts from what it held, then counts the expenses and incomes typed in after", () => {
    const records = [...pockets, expense("e1", midnight(2026, 10, 5), 12000, { wallet: "mvola" }), income("i1", midnight(2026, 10, 6), 50000, { wallet: "cash" })];
    expect(balances(records)).toEqual({ cash: 95000, mvola: 218000, bank: 500000 });
    expect(walletBook(records, [], now).total).toBe(813000);
  });

  it("ignores what happened before its starting balance, and what is dated later than today", () => {
    const records = [...pockets, expense("old", midnight(2026, 9, 28), 9000, { wallet: "cash" }), expense("later", midnight(2026, 11, 2), 7000, { wallet: "cash" })];
    expect(balances(records).cash).toBe(45000);
  });

  it("on its first day, counts a line dated by its day only when typed in after the pocket was set", () => {
    expect(countsOn({ startAt: start }, midnight(2026, 10, 1), day(2026, 10, 1, 7), now)).toBe(false);
    expect(countsOn({ startAt: start }, midnight(2026, 10, 1), day(2026, 10, 1, 9), now)).toBe(true);
    expect(countsOn({ startAt: start }, midnight(2026, 10, 2), undefined, now)).toBe(true);
  });

  it("puts a line without a pocket where its payment says, else in the default pocket", () => {
    const records = [...pockets, expense("card", midnight(2026, 10, 5), 1000, { payment: "card" }), expense("mobile", midnight(2026, 10, 5), 2000, { payment: "mobile" }), expense("none", midnight(2026, 10, 5), 3000)];
    expect(balances(records)).toEqual({ cash: 42000, mvola: 228000, bank: 499000 });
  });

  it("counts lines kept out of the budget nowhere", () => {
    const records = [...pockets, { ...base, kind: "recurring", id: "rent", flow: "expense", label: "Loyer", amountMga: 100000, category: "rent", day: 5, startMonth: "2026-10", remind: "none", skipped: [] } as ExpenseRecord, exclusion("recurring:rent:2026-10")];
    expect(balances(records).cash).toBe(45000);
  });

  it("moves a transfer typed in, its fees an expense from the first pocket, counted once", () => {
    const records = [...pockets, transfer("t1", "mvola", "cash", 100000, { feesMga: 1500 })];
    expect(balances(records)).toEqual({ cash: 145000, mvola: 128500, bank: 500000 });
    const items = monthExpenses(records, [], "2026-10");
    expect(items.map((item) => [item.key, item.origin, item.amountMga])).toEqual([[transferFeesKey("t1"), "fees", 1500]]);
    expect(monthBalance(items, monthIncomes(records, "2026-10")).spent).toBe(1500);
  });

  it("adds a correction, neither spent nor earned", () => {
    const records = [...pockets, correction("c1", "mvola", 3500)];
    expect(balances(records).mvola).toBe(233500);
    expect(monthExpenses(records, [], "2026-10")).toEqual([]);
    expect(correctionFor(233500, 230000)).toBe(-3500);
  });

  it("keeps an archived pocket's balance but leaves it out of the total and the default", () => {
    const records = [wallet("cash", "cash", 45000, { archived: true }), wallet("mvola", "mvola", 230000)];
    const book = walletBook(records, [], now);
    expect(book.balances.get("cash")).toBe(45000);
    expect(book.total).toBe(230000);
    expect(primaryWallet(book.context.wallets)?.id).toBe("mvola");
  });

  it("uses the pocket marked default, else cash", () => {
    expect(primaryWallet(pockets)?.id).toBe("cash");
    expect(primaryWallet([...pockets.slice(0, 2), wallet("bank", "bank", 0, { primary: true })])?.id).toBe("bank");
    expect(walletForPayment(pockets, "mobile")?.id).toBe("mvola");
  });
});

describe("computed lines", () => {
  it("takes a Mobile Money receipt from its operator's pocket, a cash ticket from cash, the rest from the default pocket", () => {
    const sources = sourceItems({
      receipts: [scan("mm", { operator: "mvola", payment: "mobile_money", total: 15000 }), scan("cash", { operator: null, payment: "cash", total: 4000, reference: "T2" })],
      bills: [],
      lists: [{ id: "l1", title: "Courses", kind: "shopping", items: [{ id: "a", text: "Riz", done: true, priceMga: 6000 }], updatedAt: day(2026, 10, 26) } as never],
    });
    const context = walletContext(pockets);
    const items = monthExpenses(pockets, sources, "2026-10");
    const where = Object.fromEntries(items.map((item) => [item.key, lineWallet(context, item)]));
    expect(where).toEqual({ [receiptKey("mm")]: "mvola", [receiptKey("cash")]: "cash", "list:l1": "cash" });
    expect(balances(pockets, sources)).toEqual({ cash: 35000, mvola: 215000, bank: 500000 });
  });

  it("goes to the only Mobile Money pocket when the operator has none, and follows the pocket picked", () => {
    const sources = sourceItems({ receipts: [scan("mm", { operator: "airtel_money", payment: "mobile_money", total: 15000 })] });
    expect(balances(pockets, sources).mvola).toBe(215000);
    expect(balances([...pockets, pick(receiptKey("mm"), "bank")], sources)).toEqual({ cash: 45000, mvola: 230000, bank: 485000 });
  });

  it("brings Mobile Money received into its operator's pocket", () => {
    const sources = sourceItems({ receipts: [scan("in", { total: 80000 }, "in")] });
    expect(balances(pockets, sources).mvola).toBe(310000);
  });
});

describe("scanned moves between one's own pockets", () => {
  it("reads the demo withdrawal as a withdrawal", () => {
    for (const locale of ["fr", "en"] as const) expect(AnalysisSchema.parse(mockReceipt(locale, "own")).document?.receipt?.ownKind).toBe("withdrawal");
    expect(mockReceipt("fr").document?.receipt?.ownKind).toBeNull();
  });

  it("gives older scans no kind of move", () => {
    const old = normalizeStoredAnalysis({ category: "document", document: { receipt: { total: 1000, direction: "own" } } }) as Analysis;
    expect(old.document?.receipt).toMatchObject({ direction: "own", ownKind: null });
  });

  it("moves a withdrawal from the operator's pocket to cash, the fees spent once", () => {
    const sources = sourceItems({ receipts: [scan("w", {}, "own")] });
    const book = walletBook(pockets, sources, now);
    expect(Object.fromEntries(book.balances)).toEqual({ cash: 245000, mvola: 27400, bank: 500000 });
    const items = monthExpenses(pockets, sources, "2026-10");
    expect(items.map((item) => [item.origin, item.amountMga])).toEqual([["fees", 2600]]);
    expect(book.moves).toMatchObject([{ key: receiptKey("w"), from: "mvola", to: "cash", amountMga: 200000, auto: true }]);
    expect(pendingMoves(book, now)).toEqual([]);
  });

  it("moves a deposit from cash to the operator's pocket", () => {
    const sources = sourceItems({ receipts: [scan("d", { ownKind: "deposit", fees: null, total: 40000 }, "own")] });
    expect(balances(pockets, sources)).toEqual({ cash: 5000, mvola: 270000, bank: 500000 });
  });

  it("leaves a transfer's arrival to choose, counting only what left until then", () => {
    const sources = sourceItems({ receipts: [scan("t", { ownKind: "transfer", fees: 1000, total: 101000 }, "own")] });
    const book = walletBook(pockets, sources, now);
    expect(Object.fromEntries(book.balances)).toEqual({ cash: 45000, mvola: 129000, bank: 500000 });
    expect(pendingMoves(book, now).map((move) => move.key)).toEqual([receiptKey("t")]);
    const chosen = walletBook([...pockets, pick(arrivalKey(receiptKey("t")), "bank")], sources, now);
    expect(Object.fromEntries(chosen.balances)).toEqual({ cash: 45000, mvola: 129000, bank: 600000 });
    expect(pendingMoves(chosen, now)).toEqual([]);
  });

  it("treats a move scanned before the kind existed as a transfer to finish", () => {
    const sources = sourceItems({ receipts: [scan("o", { ownKind: null }, "own")] });
    expect(pendingMoves(walletBook(pockets, sources, now), now)).toHaveLength(1);
  });

  it("moves nothing once the receipt is counted as an expense", () => {
    const sources = sourceItems({ receipts: [scan("w", {}, "own")] });
    const records = [...pockets, exclusion(keepKey(receiptKey("w")))];
    expect(walletBook(records, sources, now).moves).toEqual([]);
    expect(balances(records, sources)).toEqual({ cash: 45000, mvola: 27400, bank: 500000 });
  });
});

describe("an older app", () => {
  const added: ExpenseRecord[] = [...pockets, transfer("t1", "mvola", "cash", 1000), correction("c1", "cash", 500), pick("bill:x", "bank")];

  it("never counts the new kinds: it reads records by kind", () => {
    for (const kind of ["expense", "income", "recurring", "budget", "category", "exclusion"] as const) expect(byKind(added, kind)).toEqual([]);
    expect(hasOwnExpenses(added)).toBe(false);
    expect(monthIncomes(added, "2026-10")).toEqual([]);
  });

  it("keeps them as they came when synced", async () => {
    for (const record of added) await expenseStore.rawPut(record);
    const kept = await expenseStore.list();
    expect(kept.filter((record) => ["wallet", "transfer", "correction", "walletPick"].includes(record.kind))).toHaveLength(added.length);
    await expenseStore.wipe();
  });
});
