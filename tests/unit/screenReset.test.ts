import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockReceipt } from "@/lib/ai/mock";
import type { Analysis } from "@/lib/ai/schema";
import {
  byKind,
  monthExpenses,
  monthIncomes,
  monthKey,
  receiptKey,
  RESET_ID,
  sourceItems,
  walletPickId,
  type ExpenseRecord,
  type ReceiptScan,
  type SavingsGoal,
  type Wallet,
} from "@/lib/expenses";
import type { Loan } from "@/lib/loans";
import { computedLineCount, expenseResetCounts, expenseResetIds, loanResetCounts, pocketResetCounts, resetSince, sourcesSince } from "@/lib/screenReset";
import { walletBook } from "@/lib/wallets";
import type { Parcel } from "@/services/parcelStore";

// A fake Supabase table (rowSync: read page by page, upserted by batches),
// and what the app's POST /api/loans/share is answered.
type Row = { id: string; data: Record<string, unknown>; updated_at: string; deleted_at: string | null; user_id: string };
const server = vi.hoisted(() => ({
  rows: [] as Row[],
  ranges: [] as Array<[number, number]>,
  batches: [] as number[],
  share: null as ((body: { action: string; person?: string }) => unknown) | null,
  revoked: [] as string[],
}));
vi.mock("@/lib/supabase", () => ({
  accountsAvailable: true,
  supabase: () => ({
    from: () => ({
      select: () => ({
        order: () => ({
          range: async (from: number, to: number) => {
            server.ranges.push([from, to]);
            // Like Supabase: never more than 1000 rows in one answer.
            return { data: server.rows.slice(from, Math.min(to + 1, from + 1000)), error: null };
          },
        }),
      }),
      upsert: async (rows: Row | Row[]) => {
        const list = [rows].flat();
        server.batches.push(list.length);
        for (const row of list) server.rows = [...server.rows.filter((other) => other.id !== row.id), row];
        return { error: null };
      },
    }),
  }),
}));
vi.mock("@/services/account", () => ({ authHeaders: async () => ({}) }));
vi.mock("@/services/httpClient", () => ({
  httpClient: {
    post: async (_url: string, body: { action: string; person?: string }) => {
      if (!server.share) throw new TypeError("Failed to fetch");
      if (body.action === "revoke" && body.person) server.revoked.push(body.person);
      return server.share(body);
    },
  },
}));

const { expenseStore } = await import("@/services/expenseStore");
const { householdExpenseStore } = await import("@/services/householdExpenseStore");
const { loanStore } = await import("@/services/loanStore");
const { loanProofStore } = await import("@/services/loanProofStore");
const { parcelStore } = await import("@/services/parcelStore");
const { syncParcels } = await import("@/services/parcelSync");
const { resetScreen, ResetOfflineError } = await import("@/services/screenReset");

const day = (year: number, month: number, date: number, hour = 12) => new Date(year, month - 1, date, hour).getTime();
const start = day(2026, 10, 1, 8);
const base = { createdAt: start, updatedAt: start };

const wallet = (id: string, startMga: number, startAt = start): Wallet => ({ ...base, kind: "wallet", id, name: id, type: "cash", startMga, startAt });
const goal: SavingsGoal = { ...base, kind: "savingsGoal", id: "goal", name: "Moto", targetMga: 900000, deposits: [{ id: "d1", at: day(2026, 10, 5), amountMga: 20000, wallet: "cash" }] };

/** One of every kind "Mes dépenses" keeps. */
const everyKind: ExpenseRecord[] = [
  { ...base, kind: "expense", id: "e1", at: day(2026, 10, 3), amountMga: 5000, category: "market", wallet: "cash" },
  { ...base, kind: "expense", id: "e2", at: day(2026, 10, 4), amountMga: 7000, category: "market" },
  { ...base, kind: "income", id: "i1", at: day(2026, 10, 2), amountMga: 300000, income: "salary", wallet: "cash" },
  { ...base, kind: "recurring", id: "r1", flow: "expense", label: "Loyer", amountMga: 150000, category: "home", day: 5, startMonth: "2026-01", remind: "none", skipped: [] },
  { ...base, kind: "budget", id: "budget", total: 800000, categories: {} },
  { ...base, kind: "category", id: "c1", name: "Église", color: "#2e9e5b", icon: "church" },
  { ...base, kind: "exclusion", id: "exclusion:bill:x", sourceKey: "bill:x" },
  wallet("cash", 50000),
  { ...base, kind: "transfer", id: "t1", from: "cash", to: "mvola", at: day(2026, 10, 6), amountMga: 10000 },
  { ...base, kind: "correction", id: "k1", wallet: "cash", at: day(2026, 10, 7), amountMga: 1000 },
  { ...base, kind: "walletPick", id: walletPickId("receipt:s1"), sourceKey: "receipt:s1", wallet: "cash" },
  goal,
  { ...base, kind: "tontine", id: "tontine", name: "Tontine", amountMga: 10000, frequency: "monthly", members: 5, startAt: start, myTurn: 2, remind: false, deposits: [] },
  { ...base, kind: "activity", id: "activity", separate: true },
];

type Receipt = NonNullable<NonNullable<Analysis["document"]>["receipt"]>;
const scan = (id: string, createdAt: number, receipt: Partial<Receipt> = {}): ReceiptScan => {
  const demo = mockReceipt("fr", "out");
  return { id, createdAt, analysis: { document: { ...demo.document!, receipt: { ...demo.document!.receipt!, date: "2026-10-03", ...receipt } } } };
};

describe("what each reset removes", () => {
  it("Dépenses et revenus: everything but the pockets and the categories", () => {
    const removed = new Set(expenseResetIds(everyKind, "expenses"));
    const kinds = (keep: boolean) => everyKind.filter((record) => removed.has(record.id) !== keep).map((record) => record.kind);
    expect(kinds(false).sort()).toEqual(["activity", "budget", "exclusion", "expense", "expense", "income", "recurring", "savingsGoal", "tontine"].sort());
    expect(kinds(true).sort()).toEqual(["category", "correction", "transfer", "wallet", "walletPick"].sort());
  });

  it("Poches: the pockets, the moves, the corrections and the pockets picked, nothing else", () => {
    const removed = new Set(expenseResetIds(everyKind, "pockets"));
    expect(everyKind.filter((record) => removed.has(record.id)).map((record) => record.kind).sort()).toEqual(["correction", "transfer", "wallet", "walletPick"]);
  });

  it("never takes a record removed already, nor the reset mark", () => {
    const records: ExpenseRecord[] = [
      { ...base, kind: "expense", id: "gone", at: start, amountMga: 1, category: "market", deletedAt: start },
      { ...base, kind: "reset", id: RESET_ID, at: start },
    ];
    expect(expenseResetIds(records, "expenses")).toEqual([]);
    expect(expenseResetIds(records, "pockets")).toEqual([]);
  });

  it("counts what the window lists", () => {
    expect(expenseResetCounts(everyKind)).toEqual({ expenses: 2, incomes: 1, recurring: 1, savings: 2, budget: true });
    expect(pocketResetCounts(everyKind)).toEqual({ pockets: 1, moves: 2, picks: 1 });
    const loans = [
      { id: "l1", direction: "lent", person: "Rakoto", amountMga: 1000, at: start, updatedAt: start, repayments: [{ id: "p", amountMga: 100, at: start }], proofs: [{ id: "f", kind: "photo", addedAt: start }] },
      { id: "l2", direction: "borrowed", person: "Be", amountMga: 1000, at: start, updatedAt: start, repayments: [] },
      { id: "l3", direction: "lent", person: "Gone", amountMga: 1000, at: start, updatedAt: start, repayments: [], deletedAt: start },
    ] as Loan[];
    expect(loanResetCounts(loans)).toEqual({ loans: 2, repayments: 1, proofs: 1 });
  });
});

describe("the lines taken from the rest of the app after a reset", () => {
  const reset = day(2026, 10, 15);
  const parcel = (id: string, createdAt: number) => ({ id, title: id, priceMga: 40000, fees: [], createdAt });

  it("leaves out the scans made before, whatever their date, and the other lines dated before", () => {
    const inputs = {
      receipts: [scan("old", day(2026, 10, 3), { reference: "A1" }), scan("new", day(2026, 10, 20), { reference: "B2" })],
      parcels: [parcel("p-old", day(2026, 10, 2)), parcel("p-new", day(2026, 10, 18))],
    };
    const keys = sourcesSince(inputs, reset).map((item) => item.key);
    expect(keys).toContain(receiptKey("new"));
    expect(keys).toContain("parcel:p-new");
    expect(keys).not.toContain(receiptKey("old"));
    expect(keys).not.toContain("parcel:p-old");
    // Never reset: every line, as before.
    expect(sourcesSince(inputs, undefined)).toEqual(sourceItems(inputs));
  });

  it("counts a receipt scanned again after the reset, not as a copy of the one before", () => {
    const inputs = { receipts: [scan("first", day(2026, 10, 3), { reference: "SAME" }), scan("again", day(2026, 10, 20), { reference: "SAME" })] };
    // Without the reset, the second scan points to the first one.
    expect(sourceItems(inputs).find((item) => item.key === receiptKey("again"))?.sameAs).toBe(receiptKey("first"));
    const items = sourcesSince(inputs, reset);
    expect(items.map((item) => item.key)).toEqual([receiptKey("again")]);
    expect(items[0].sameAs).toBeUndefined();
    expect(monthExpenses([], items, monthKey(day(2026, 10, 3))).map((item) => item.key)).toEqual([receiptKey("again")]);
  });

  it("counts the lines Dépenses shows from elsewhere, so a screen of only those can be reset", () => {
    const inputs = {
      receipts: [scan("first", day(2026, 10, 3), { reference: "SAME" }), scan("again", day(2026, 10, 4), { reference: "SAME" })],
      parcels: [parcel("p1", day(2026, 10, 2))],
    };
    // The parcel and the first scan; the second scan of the same transaction is no line of its own.
    expect(computedLineCount(sourcesSince(inputs, undefined))).toBe(2);
    expect(computedLineCount(sourcesSince(inputs, reset))).toBe(0);
  });

  it("reads the last reset from the records", () => {
    expect(resetSince(everyKind)).toBeUndefined();
    expect(resetSince([...everyKind, { ...base, kind: "reset", id: RESET_ID, at: reset }])).toBe(reset);
  });
});

describe("the pockets gone", () => {
  const now = day(2026, 10, 29);
  const remaining = (records: ExpenseRecord[]) => {
    const removed = new Set(expenseResetIds(records, "pockets"));
    return records.filter((record) => !removed.has(record.id));
  };

  it("leave the lines without a pocket, with no balance anywhere", () => {
    const after = remaining(everyKind);
    const book = walletBook(after, sourceItems({}), now);
    expect(book.context.wallets).toEqual([]);
    expect(book.total).toBe(0);
    expect([...book.balances.values()]).toEqual([]);
    // The expenses and incomes are still there, in the month.
    expect(monthExpenses(after, [], "2026-10").map((item) => item.key)).toContain("manual:e1");
    expect(monthIncomes(after, "2026-10").map((item) => item.key)).toContain("manual:i1");
  });

  it("count nothing old in a new pocket: no ghost amount from the lines that named the old one", () => {
    const fresh = wallet("fresh", 20000, day(2026, 10, 20));
    const book = walletBook([...remaining(everyKind), { ...fresh, primary: true }], sourceItems({}), now);
    // The old expenses, income, deposit and correction named "cash": none of them moves the new pocket.
    expect(book.balances.get("fresh")).toBe(20000);
    expect(book.movements.get("fresh")).toEqual([]);
    expect(book.total).toBe(20000);
  });

  it("leave the loans' moves out too (their pocket is unknown)", () => {
    const loans = [{ id: "l1", direction: "lent", person: "Rakoto", amountMga: 30000, at: day(2026, 10, 21), updatedAt: start, repayments: [], wallet: "cash" }] as Loan[];
    const fresh = wallet("fresh", 20000, day(2026, 10, 20));
    expect(walletBook([...remaining(everyKind), fresh], sourceItems({}), now, loans).balances.get("fresh")).toBe(20000);
  });
});

describe("resetting a screen on the device", () => {
  beforeEach(async () => {
    await Promise.all([expenseStore.wipe(), householdExpenseStore.wipe(), loanStore.wipe(), parcelStore.wipe()]);
    expenseStore.setKeepTombstones(true);
    loanStore.setKeepTombstones(true);
    parcelStore.setKeepTombstones(true);
    server.rows = [];
    server.ranges = [];
    server.batches = [];
    server.share = null;
    server.revoked = [];
  });

  it("Dépenses: tombstones to sync, the pockets and the household's expenses kept, and a reset mark", async () => {
    for (const record of everyKind) await expenseStore.rawPut(record);
    await householdExpenseStore.save({ at: start, amountMga: 9000, category: "market" }, "me");
    await resetScreen("expenses");
    const raw = await expenseStore.raw();
    const removed = raw.filter((record) => record.deletedAt);
    expect(removed.every((record) => record.dirty)).toBe(true);
    expect(removed).toHaveLength(9);
    const left = await expenseStore.list();
    expect(left.map((record) => record.kind).sort()).toEqual(["category", "correction", "reset", "transfer", "wallet", "walletPick"]);
    expect(resetSince(left)).toBeGreaterThan(0);
    expect(await householdExpenseStore.list()).toHaveLength(1);
  });

  it("Poches: only the pockets' records", async () => {
    for (const record of everyKind) await expenseStore.rawPut(record);
    await resetScreen("pockets");
    const left = await expenseStore.list();
    expect(byKind(left, "wallet")).toEqual([]);
    expect(left.map((record) => record.kind)).not.toContain("transfer");
    expect(byKind(left, "expense")).toHaveLength(2);
    expect(byKind(left, "savingsGoal")).toHaveLength(1);
  });

  it("Prêts: the links stopped first, then every loan and its photos", async () => {
    await loanStore.rawPut({ id: "l1", direction: "lent", person: "Rakoto", amountMga: 1000, at: start, updatedAt: start, repayments: [], proofs: [{ id: "f1", kind: "photo", addedAt: start, remote: "u/f1" }] } as Loan);
    await loanProofStore.put({ id: "f1", loanId: "l1", preview: "data:p", thumbnail: "data:t", addedAt: start });
    server.share = (body) => (body.action === "status" ? { ready: true, household: false, shares: [{ person: "rakoto", lender: "Me" }, { person: "be", lender: "Me" }] } : { ok: true, found: true });
    await resetScreen("loans");
    expect(server.revoked.sort()).toEqual(["be", "rakoto"]);
    expect(await loanStore.list()).toEqual([]);
    expect(await loanProofStore.get("f1")).toBeUndefined();
    expect((await loanProofStore.pendingRemovals()).length).toBeGreaterThan(0);
  });

  it("Prêts, offline with an account: nothing removed (a borrower would keep reading the old copy)", async () => {
    await loanStore.rawPut({ id: "l1", direction: "lent", person: "Rakoto", amountMga: 1000, at: start, updatedAt: start, repayments: [] } as Loan);
    const { loanSharing } = await import("@/services/loanSharing");
    await loanSharing.ensure("user-1", true);
    await expect(resetScreen("loans")).rejects.toBeInstanceOf(ResetOfflineError);
    expect(await loanStore.list()).toHaveLength(1);
  });

  it("Prêts, offline without an account: no link to stop, the loans go", async () => {
    await loanStore.rawPut({ id: "l1", direction: "lent", person: "Rakoto", amountMga: 1000, at: start, updatedAt: start, repayments: [] } as Loan);
    const { loanSharing } = await import("@/services/loanSharing");
    await loanSharing.ensure("device", true);
    await resetScreen("loans");
    expect(await loanStore.list()).toEqual([]);
  });

  it("Prêts, signed out or before the sharing: nothing to stop", async () => {
    await loanStore.rawPut({ id: "l1", direction: "lent", person: "Rakoto", amountMga: 1000, at: start, updatedAt: start, repayments: [] } as Loan);
    const { ApiError } = await import("@/types/api");
    server.share = () => {
      throw new ApiError("Sign in.", 401, { error: { code: "sign_in_required", message: "Sign in." } });
    };
    await resetScreen("loans");
    expect(await loanStore.list()).toEqual([]);
  });

  it("Colis: every parcel, and many of them reach the account by batches", async () => {
    const parcels = Array.from({ length: 450 }, (_, index) => ({ id: `p${index}`, title: `Colis ${index}`, info: {}, scanIds: [], timeline: [], createdAt: start, updatedAt: start }) as unknown as Parcel);
    for (const parcel of parcels) await parcelStore.rawPut(parcel);
    await resetScreen("parcels");
    expect(await parcelStore.list()).toEqual([]);
    await syncParcels("me");
    expect(server.batches).toEqual([200, 200, 50]);
    expect(server.rows.filter((row) => row.deleted_at)).toHaveLength(450);
    // Synced: the tombstones are gone from the device.
    expect(await parcelStore.raw()).toEqual([]);
  });
});

describe("the sync with many rows", () => {
  beforeEach(async () => {
    await parcelStore.wipe();
    server.rows = [];
    server.ranges = [];
    server.batches = [];
  });

  it("reads every page, so a removal beyond the first 1000 rows reaches this device", async () => {
    const at = new Date(start).toISOString();
    const later = new Date(start + 1000).toISOString();
    server.rows = Array.from({ length: 2300 }, (_, index) => ({
      id: `p${String(index).padStart(4, "0")}`,
      data: { title: `Colis ${index}`, info: {}, scanIds: [], timeline: [], createdAt: start },
      updated_at: index === 2200 ? later : at,
      deleted_at: index === 2200 ? later : null,
      user_id: "me",
    }));
    await parcelStore.rawPut({ id: "p2200", title: "Gone", info: {}, scanIds: [], timeline: [], createdAt: start, updatedAt: start } as unknown as Parcel);
    await syncParcels("me");
    expect(server.ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    expect(await parcelStore.rawGet("p2200")).toBeUndefined();
    expect((await parcelStore.list()).length).toBe(2299);
  });
});
