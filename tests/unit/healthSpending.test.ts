import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { MonthItem } from "@/lib/expenses";
import type { HealthProfile } from "@/lib/healthProfiles";
import {
  canGoForward,
  cleanHealthSpend,
  expenseLines,
  healthMonth,
  healthTagOf,
  mergeLines,
  movedExpense,
  movedExpenseId,
  previousTotal,
  readAmount,
  readHealthSpend,
  receiptSpend,
  spendLine,
  totalsByPerson,
  type HealthSpend,
} from "@/lib/healthSpending";
import { expenseStore } from "@/services/expenseStore";
import { healthSpendStore } from "@/services/healthSpendStore";

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();
const rado: HealthProfile = { id: "rado", name: "Rado", relation: "child", updatedAt: 1 } as HealthProfile;

const spend = (fields: Partial<HealthSpend>): HealthSpend => ({ id: "s1", at: day(2026, 11, 3), amountMga: 10000, kind: "pharmacy", createdAt: 1, updatedAt: 1, ...fields });

describe("health spending", () => {
  it("reads an amount in ariary, with spaces, dots or Ar", () => {
    expect(readAmount("12 500")).toBe(12500);
    expect(readAmount("12.500")).toBe(12500);
    expect(readAmount("12 500 Ar")).toBe(12500);
    expect(readAmount("12 500")).toBe(12500);
    expect(readAmount("")).toBeNull();
    expect(readAmount("0")).toBeNull();
    expect(readAmount("12,5")).toBeNull();
    expect(readAmount("abc")).toBeNull();
    expect(readAmount("2000000000")).toBeNull();
  });

  it("checks the form: amount and day; Moi is no profile", () => {
    expect(cleanHealthSpend({ at: Number.NaN, amount: "x", kind: "pharmacy" }).wrong).toEqual(["amount", "at"]);
    const { fields } = cleanHealthSpend({ at: day(2026, 11, 3), amount: "8 000", kind: "tests", profileId: "me", note: "  labo  " });
    expect(fields).toEqual({ at: day(2026, 11, 3), amountMga: 8000, kind: "tests", note: "labo" });
    expect(cleanHealthSpend({ at: 1, amount: "5", kind: "nope" as never, profileId: "rado" }).fields).toMatchObject({ kind: "other", profileId: "rado" });
  });

  it("reads back what another version stored", () => {
    expect(readHealthSpend(spend({ kind: "dentist" as never }))?.kind).toBe("other");
    expect(readHealthSpend(spend({ amountMga: 0 }))).toBeNull();
  });

  it("reads the health tag of an expense of the category health only", () => {
    expect(healthTagOf({ category: "market", health: { kind: "pharmacy" } } as never)).toBeNull();
    expect(healthTagOf({ category: "health" })).toEqual({ kind: "other" });
    expect(healthTagOf({ category: "health", health: { kind: "hospital", profileId: "rado" } } as never)).toEqual({ kind: "hospital", profileId: "rado" });
  });

  it("totals a person's month by kind, with the month before and each person", () => {
    const lines = [
      spendLine(spend({ id: "a", amountMga: 12000 })),
      spendLine(spend({ id: "b", amountMga: 30000, kind: "consultation", at: day(2026, 11, 8) })),
      spendLine(spend({ id: "c", amountMga: 5000, profileId: "rado" })),
      spendLine(spend({ id: "d", amountMga: 7000, at: day(2026, 10, 20) })),
      // A relative removed since: back to Moi.
      spendLine(spend({ id: "e", amountMga: 1000, profileId: "gone" })),
    ];
    const month = healthMonth(lines, "2026-11", "me", [rado]);
    expect(month.total).toBe(43000);
    expect(month.lines.map((line) => line.id)).toEqual(["b", "a", "e"]);
    expect(month.byKind).toEqual([
      { kind: "pharmacy", total: 13000 },
      { kind: "consultation", total: 30000 },
    ]);
    expect(previousTotal(lines, "2026-11", "me", [rado])).toBe(7000);
    expect(healthMonth(lines, "2026-11", "rado", [rado]).total).toBe(5000);
    expect(totalsByPerson(lines, "2026-11", [rado])).toEqual([
      { person: "me", total: 43000 },
      { person: "rado", total: 5000 },
    ]);
  });

  it("takes the health lines of Mes dépenses, as counted there, without a receipt twice", () => {
    const item = (fields: Partial<MonthItem>): MonthItem => ({ key: "k", origin: "manual", at: day(2026, 11, 5), amountMga: 9000, category: "health", excluded: false, ...fields });
    const items = [
      item({ key: "manual:1", record: { id: "x1", kind: "expense", at: day(2026, 11, 5), amountMga: 9000, category: "health", health: { kind: "consultation", profileId: "rado" }, createdAt: 1, updatedAt: 1 } }),
      item({ key: "receipt:scan-1", origin: "receipt", scanId: "scan-1", label: "Pharmacie" }),
      item({ key: "receipt:scan-2", origin: "receipt", scanId: "scan-2" }),
      item({ key: "market", category: "market" }),
      item({ key: "out", excluded: true }),
      item({ key: "doubt", doubt: true }),
    ];
    const lines = expenseLines(items, (scanId) => (scanId === "scan-2" ? "rado" : undefined));
    expect(lines.map((line) => [line.from, line.kind, line.profileId])).toEqual([
      ["expense", "consultation", "rado"],
      ["computed", "pharmacy", undefined],
      ["computed", "pharmacy", "rado"],
    ]);
    // The receipt also kept in Ma santé's own list: counted once.
    const merged = mergeLines([spendLine(spend({ scanId: "scan-1" }))], lines);
    expect(merged.filter((line) => line.scanId === "scan-1")).toHaveLength(1);
    expect(merged).toHaveLength(3);
  });

  it("makes a health expense of a pharmacy receipt paid in ariary only", () => {
    const scan = (receipt: object, profileId?: string) => ({ id: "scan-9", createdAt: day(2026, 11, 4), profileId, analysis: { document: { receipt: { total: 15500, currency: "MGA", date: "2026-11-02", merchant: "Pharmacie Soa", category: "health", direction: "out", ...receipt } } } }) as never;
    expect(receiptSpend(scan({}, "rado"))).toEqual({ at: day(2026, 11, 2), amountMga: 15500, kind: "pharmacy", profileId: "rado", note: "Pharmacie Soa", scanId: "scan-9" });
    expect(receiptSpend(scan({ category: "market" }))).toBeNull();
    expect(receiptSpend(scan({ direction: "in" }))).toBeNull();
    expect(receiptSpend(scan({ currency: "EUR" }))).toBeNull();
    expect(receiptSpend(scan({ total: null }))).toBeNull();
  });
});

describe("moved to Mes dépenses", () => {
  it("becomes the same expense every time, standing for its receipt", () => {
    const moved = movedExpense(spend({ id: "s9", kind: "tests", profileId: "rado", note: "Labo", scanId: "scan-1" }));
    expect(moved).toEqual({
      id: movedExpenseId("s9"),
      at: day(2026, 11, 3),
      amountMga: 10000,
      category: "health",
      note: "Labo",
      health: { kind: "tests", profileId: "rado" },
      scanId: "scan-1",
      sourceKey: "receipt:scan-1",
    });
    expect(movedExpense(spend({ id: "s9" })).id).toBe(moved.id);
  });

  it("is counted once while the removal of the own one is not synced yet", () => {
    const own = [spendLine(spend({ id: "s9" }))];
    const expense = { key: "expense:x", from: "expense" as const, id: movedExpenseId("s9"), at: day(2026, 11, 3), amountMga: 10000, kind: "pharmacy" as const };
    expect(mergeLines(own, [expense])).toEqual([expense]);
  });

  it("never goes past the current month", () => {
    expect(canGoForward("2026-10", day(2026, 11, 12))).toBe(true);
    expect(canGoForward("2026-11", day(2026, 11, 12))).toBe(false);
  });
});

describe("health spending stores", () => {
  it("keeps Ma santé's kind and person on an expense changed elsewhere, while it stays a health one", async () => {
    const saved = await expenseStore.saveExpense({ at: day(2026, 11, 3), amountMga: 20000, category: "health", health: { kind: "hospital", profileId: "rado" } });
    // "Mes dépenses" changes the amount: its form knows nothing of the tag.
    await expenseStore.saveExpense({ id: saved!.id, at: saved!.at, amountMga: 25000, category: "health" });
    let record = (await expenseStore.list()).find((item) => item.id === saved!.id);
    expect(record).toMatchObject({ amountMga: 25000, health: { kind: "hospital", profileId: "rado" } });
    // Moved to another category: no longer a health expense.
    await expenseStore.saveExpense({ id: saved!.id, at: saved!.at, amountMga: 25000, category: "market" });
    record = (await expenseStore.list()).find((item) => item.id === saved!.id);
    expect(record && "health" in record && record.health).toBeFalsy();
  });

  it("moves the own list into Mes dépenses once, even tapped twice or run again", async () => {
    await healthSpendStore.removeAll();
    await healthSpendStore.add({ at: day(2026, 10, 3), amountMga: 7000, kind: "consultation", note: "Dr Rabe" });
    await healthSpendStore.add({ at: day(2026, 11, 3), amountMga: 3000, kind: "pharmacy", profileId: "rado" });
    const before = (await expenseStore.list()).length;
    const [first, second] = await Promise.all([healthSpendStore.moveToExpenses(), healthSpendStore.moveToExpenses()]);
    expect([first, second]).toEqual([2, 2]);
    expect(await healthSpendStore.moveToExpenses()).toBe(0);
    const moved = (await expenseStore.list()).filter((record) => record.id.startsWith("health:"));
    expect((await expenseStore.list()).length - before).toBe(2);
    expect(moved.map((record) => record.kind === "expense" && [record.amountMga, record.category, record.health?.kind, record.note]).sort()).toEqual([
      [3000, "health", "pharmacy", undefined],
      [7000, "health", "consultation", "Dr Rabe"],
    ]);
    expect(await healthSpendStore.list()).toEqual([]);
    // The same spend moved again (another device before the sync): the same expense, rewritten.
    await healthSpendStore.rawPut({ id: moved[0].id.slice("health:".length), at: day(2026, 11, 3), amountMga: 3000, kind: "pharmacy", createdAt: 1, updatedAt: 1 });
    await healthSpendStore.moveToExpenses();
    expect((await expenseStore.list()).length - before).toBe(2);
  });

  it("adds, edits, gives back to Moi and removes Ma santé's own expenses", async () => {
    const added = await healthSpendStore.add({ at: day(2026, 11, 3), amountMga: 5000, kind: "pharmacy", profileId: "rado" });
    await healthSpendStore.edit(added.id, { at: day(2026, 11, 4), amountMga: 6000, kind: "tests", profileId: "rado" });
    expect((await healthSpendStore.list())[0]).toMatchObject({ amountMga: 6000, kind: "tests", profileId: "rado" });
    await healthSpendStore.reassign("rado");
    expect((await healthSpendStore.list())[0].profileId).toBeUndefined();
    await healthSpendStore.removeAll();
    expect(await healthSpendStore.list()).toEqual([]);
  });
});
