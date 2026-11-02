import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { type Correction, type ExpenseRecord, type Income, type ManualExpense, type SavingsGoal, type Transfer, type Wallet, type WalletPick } from "@/lib/expenses";
import type { Loan } from "@/lib/loans";
import { movedOrder, pocketStatement, walletBook, walletInUse, walletsOf } from "@/lib/wallets";
import { expenseStore } from "@/services/expenseStore";

const day = (year: number, month: number, date: number, hour = 12) => new Date(year, month - 1, date, hour).getTime();
const midnight = (year: number, month: number, date: number) => new Date(year, month - 1, date).getTime();
const start = day(2026, 9, 1, 8);
const now = day(2026, 10, 29, 18);
const base = { createdAt: start, updatedAt: start };

const wallet = (id: string, type: Wallet["type"], startMga: number, patch: Partial<Wallet> = {}): Wallet => ({ ...base, kind: "wallet", id, name: id, type, startMga, startAt: start, ...patch });
const expense = (id: string, at: number, amountMga: number, patch: Partial<ManualExpense> = {}): ManualExpense => ({ ...base, createdAt: at, kind: "expense", id, at, amountMga, category: "market", ...patch });
const income = (id: string, at: number, amountMga: number, patch: Partial<Income> = {}): Income => ({ ...base, createdAt: at, kind: "income", id, at, amountMga, income: "salary", ...patch });
const transfer = (id: string, from: string, to: string, at: number, amountMga: number): Transfer => ({ ...base, createdAt: at, kind: "transfer", id, from, to, at, amountMga });
const correction = (id: string, walletId: string, at: number, amountMga: number): Correction => ({ ...base, createdAt: at, kind: "correction", id, wallet: walletId, at, amountMga });
const loan = (patch: Partial<Loan>): Loan => ({ ...base, id: "l1", person: "Rakoto", direction: "lent", amountMga: 20000, at: midnight(2026, 10, 12), repayments: [], ...patch }) as Loan;

const pockets = [wallet("cash", "cash", 45000, { primary: true }), wallet("mvola", "mvola", 230000), wallet("bank", "bank", 0)];
const records: ExpenseRecord[] = [
  ...pockets,
  income("i1", midnight(2026, 9, 25), 300000, { wallet: "mvola" }),
  expense("e1", midnight(2026, 10, 5), 12000, { wallet: "mvola" }),
  transfer("t1", "mvola", "cash", midnight(2026, 10, 10), 50000),
  correction("c1", "mvola", day(2026, 10, 20), 3000),
];

describe("a pocket's statement", () => {
  it("lists every movement, the latest first, by month, with the balance after each line", () => {
    const book = walletBook(records, [], now, [loan({ wallet: "mvola" })]);
    const months = pocketStatement(book, "mvola");
    expect(months.map((month) => month.month)).toEqual(["2026-10", "2026-09"]);
    expect(months[0].lines.map((line) => [line.type, line.amountMga, line.balanceMga])).toEqual([
      ["correction", 3000, 451000],
      ["loan", -20000, 448000],
      ["move_out", -50000, 468000],
      ["expense", -12000, 518000],
    ]);
    expect(months[1].lines.map((line) => [line.type, line.amountMga, line.balanceMga])).toEqual([["income", 300000, 530000]]);
    // The first line's balance is what the pocket holds.
    expect(book.balances.get("mvola")).toBe(451000);
    // A typed-in expense or income keeps its record: the line opens it.
    expect(months[0].lines[3].recordId).toBe("e1");
    expect(months[1].lines[0].recordId).toBe("i1");
    expect(months[0].lines[1].loan?.type).toBe("lent");
  });

  it("follows the starting balance and day: every line moves, nothing is a correction", () => {
    const changed = records.map((record) => (record.id === "mvola" ? { ...record, startMga: 100000, startAt: midnight(2026, 10, 1) } : record));
    const book = walletBook(changed, [], now);
    const months = pocketStatement(book, "mvola");
    // September's income is now before the start: left out.
    expect(months.map((month) => month.month)).toEqual(["2026-10"]);
    expect(months[0].lines.map((line) => line.balanceMga)).toEqual([41000, 38000, 88000]);
    expect(book.balances.get("mvola")).toBe(41000);
  });

  it("is empty for a pocket where nothing moved", () => {
    expect(pocketStatement(walletBook(records, [], now), "bank")).toEqual([]);
  });
});

describe("removing a pocket", () => {
  const book = walletBook(records, [], now);

  it("is refused when a movement is counted on it", () => {
    expect(walletInUse(records, [], book, "mvola")).toBe(true);
    expect(walletInUse(records, [], book, "cash")).toBe(true);
  });

  it("is allowed when nothing uses it", () => {
    expect(walletInUse(records, [], book, "bank")).toBe(false);
  });

  it("is refused when a line names it, even one not counted (before its start, a pick, a deposit, a loan)", () => {
    const old = expense("old", midnight(2026, 8, 2), 1000, { wallet: "bank" });
    expect(walletInUse([...records, old], [], walletBook([...records, old], [], now), "bank")).toBe(true);
    const picked: WalletPick = { ...base, kind: "walletPick", id: "walletPick:bill:x", sourceKey: "bill:x", wallet: "bank" };
    expect(walletInUse([...records, picked], [], book, "bank")).toBe(true);
    const goal: SavingsGoal = { ...base, kind: "savingsGoal", id: "g1", name: "École", targetMga: 100000, deposits: [{ id: "d1", at: midnight(2026, 8, 3), amountMga: 5000, wallet: "bank" }] };
    expect(walletInUse([...records, goal], [], book, "bank")).toBe(true);
    expect(walletInUse(records, [loan({ wallet: "bank", at: midnight(2026, 8, 1) })], book, "bank")).toBe(true);
    expect(walletInUse(records, [loan({ wallet: "bank", deletedAt: now })], book, "bank")).toBe(false);
  });
});

describe("the pockets' order", () => {
  it("is the user's, those never moved after, the oldest first", () => {
    const list = [wallet("a", "cash", 0, { createdAt: 1 }), wallet("b", "mvola", 0, { createdAt: 2, order: 1 }), wallet("c", "bank", 0, { createdAt: 3, order: 0 })];
    expect(walletsOf(list).map((item) => item.id)).toEqual(["c", "b", "a"]);
  });

  it("moves a pocket up or down among those shown, never past the ends", () => {
    const list = [wallet("a", "cash", 0, { createdAt: 1 }), wallet("x", "other", 0, { createdAt: 2, archived: true }), wallet("b", "mvola", 0, { createdAt: 3 }), wallet("c", "bank", 0, { createdAt: 4 })];
    expect(movedOrder(list, "b", -1)).toEqual(["b", "a", "c"]);
    expect(movedOrder(list, "b", 1)).toEqual(["a", "c", "b"]);
    expect(movedOrder(list, "a", -1)).toBeNull();
    expect(movedOrder(list, "c", 1)).toBeNull();
    expect(movedOrder(list, "x", 1)).toBeNull();
  });

  it("is for display only: lines without a pocket stay where they were, every balance as before", () => {
    const list = [
      wallet("bank1", "bank", 100000, { createdAt: 1 }),
      wallet("mvola1", "mvola", 50000, { createdAt: 2 }),
      wallet("bank2", "bank", 200000, { createdAt: 3 }),
      wallet("mvola2", "mvola", 80000, { createdAt: 4 }),
    ];
    // Paid by card, by Mobile Money, and with nothing said (the default pocket): no pocket named.
    const lines = [
      expense("card", midnight(2026, 10, 3), 10000, { payment: "card" }),
      expense("mobile", midnight(2026, 10, 4), 5000, { payment: "mobile" }),
      expense("none", midnight(2026, 10, 5), 1000),
      income("in", midnight(2026, 10, 6), 7000, { wallet: undefined }),
    ];
    const before = Object.fromEntries(walletBook([...list, ...lines], [], now).balances);
    // No default pocket, no cash: the first created one takes the lines with nothing said.
    expect(before).toEqual({ bank1: 96000, mvola1: 45000, bank2: 200000, mvola2: 80000 });
    const order = ["mvola2", "bank2", "mvola1", "bank1"];
    const moved = list.map((item) => ({ ...item, order: order.indexOf(item.id) }));
    expect(walletsOf(moved).map((item) => item.id)).toEqual(order);
    expect(Object.fromEntries(walletBook([...moved, ...lines], [], now).balances)).toEqual(before);
  });

  it("is stored on each pocket, and survives an edit", async () => {
    await expenseStore.wipe();
    const a = await expenseStore.saveWallet({ name: "A", type: "cash", startMga: 0, startAt: start });
    const b = await expenseStore.saveWallet({ name: "B", type: "mvola", startMga: 0, startAt: start });
    await expenseStore.setWalletOrder([b!.id, a!.id]);
    const saved = walletsOf(await expenseStore.list());
    expect(saved.map((item) => item.name)).toEqual(["B", "A"]);
    await expenseStore.saveWallet({ ...saved[0], name: "MVola perso", type: "orange_money", startMga: 5000 });
    const edited = walletsOf(await expenseStore.list());
    expect(edited.map((item) => [item.name, item.type, item.startMga])).toEqual([
      ["MVola perso", "orange_money", 5000],
      ["A", "cash", 0],
    ]);
  });
});
