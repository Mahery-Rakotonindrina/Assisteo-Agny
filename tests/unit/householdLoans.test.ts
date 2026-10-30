import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { acceptHouseholdLoanRow, gatherHouseholdLoans, personalCopy, type HouseholdLoanRecord } from "@/lib/householdLoans";
import { loanRemaining } from "@/lib/loans";

// A fake "household_loans" table under its RLS (0012_loan_sharing.sql): every
// member reads every row, each one writes only rows in their own name.
type Row = { household_id: string; id: string; user_id: string | null; data: Record<string, unknown>; updated_at: string; deleted_at: string | null };
const server = vi.hoisted(() => ({ rows: [] as Row[], as: "" }));
vi.mock("@/lib/supabase", () => ({
  supabase: () => ({
    from: () => ({
      select: () => ({
        match: async (match: Record<string, string>) => ({ data: server.rows.filter((row) => row.household_id === match.household_id), error: null }),
      }),
      upsert: async (row: Row) => {
        if (row.user_id !== server.as) return { error: { message: "new row violates row-level security policy" } };
        const existing = server.rows.find((item) => item.household_id === row.household_id && item.id === row.id);
        if (existing && existing.user_id !== server.as) return { error: { message: "new row violates row-level security policy" } };
        if (existing) Object.assign(existing, row);
        else server.rows.push({ ...row });
        return { error: null };
      },
    }),
  }),
}));

const { householdLoanStore, syncHouseholdLoans, detachHouseholdLoans } = await import("@/services/householdLoanStore");
const { householdBook } = await import("@/services/loanBook");
const { loanStore } = await import("@/services/loanStore");

const anna = "11111111-1111-4111-8111-111111111111";
const ben = "22222222-2222-4222-8222-222222222222";
const home = "home-1";
const at = new Date(2026, 9, 1, 12).getTime();
const fields = (person: string, amountMga: number) => ({ direction: "lent" as const, person, amountMga, at });

beforeEach(async () => {
  server.rows = [];
  await householdLoanStore.wipe();
  await loanStore.wipe();
});

describe("the household's rows", () => {
  const rows: HouseholdLoanRecord[] = [
    { kind: "loan", id: "l1", direction: "lent", person: "Voisin", amountMga: 60000, at, createdAt: at, updatedAt: at, userId: anna },
    { kind: "repayment", id: "r2", loanId: "l1", at: at + 2, amountMga: 10000, updatedAt: at, userId: anna },
    { kind: "repayment", id: "r1", loanId: "l1", at: at + 1, amountMga: 20000, updatedAt: at, userId: ben },
    { kind: "repayment", id: "r3", loanId: "l1", at: at + 3, amountMga: 5000, updatedAt: at, userId: ben, deletedAt: at },
    { kind: "repayment", id: "orphan", loanId: "gone", at, amountMga: 1, updatedAt: at },
  ];

  it("gathers each loan with its repayments, whoever wrote them, oldest first", () => {
    const [loan] = gatherHouseholdLoans(rows);
    expect(loan.repayments.map((item) => [item.id, item.userId])).toEqual([
      ["r1", ben],
      ["r2", anna],
    ]);
    expect(loanRemaining(loan)).toBe(30000);
    expect(loan).not.toHaveProperty("kind");
  });

  it("gives a loan back as a personal one, with every repayment and no author", () => {
    const copy = personalCopy(gatherHouseholdLoans(rows)[0]);
    expect(copy).not.toHaveProperty("userId");
    expect(copy.repayments).toEqual([
      { id: "r1", at: at + 1, amountMga: 20000 },
      { id: "r2", at: at + 2, amountMga: 10000 },
    ]);
  });

  it("checks another member's row: malformed ones skipped, unknown fields dropped", () => {
    expect(acceptHouseholdLoanRow({ kind: "repayment", id: "x", at, amountMga: 1000, updatedAt: at })).toBeNull();
    expect(acceptHouseholdLoanRow({ kind: "loan", id: "x", direction: "lent", person: "A", amountMga: -5, at, updatedAt: at })).toBeNull();
    expect(acceptHouseholdLoanRow({ kind: "gift", id: "x", updatedAt: at })).toBeNull();
    expect(acceptHouseholdLoanRow("not a row")).toBeNull();
    const kept = acceptHouseholdLoanRow({ kind: "loan", id: "x", direction: "lent", person: "A", amountMga: 5, at, updatedAt: at, wallet: "mvola", proofs: [{ id: "p" }], repayments: [{ amountMga: 1e9 }] });
    expect(kept).not.toBeNull();
    expect(kept).not.toHaveProperty("wallet");
    expect(kept).not.toHaveProperty("proofs");
    expect(kept).not.toHaveProperty("repayments");
  });
});

describe("the household's loans on the device", () => {
  it("lets any member note a repayment, only the author change the loan", async () => {
    const annaBook = householdBook(anna);
    const benBook = householdBook(ben);
    const loan = (await annaBook.create({ ...fields("Voisin", 60000), wallet: "mvola" }))!;
    expect(loan).not.toHaveProperty("wallet");
    expect(await benBook.addRepayment(loan.id, { amountMga: 20000, at })).toBe(20000);
    // Capped to what is left.
    expect(await annaBook.addRepayment(loan.id, { amountMga: 99999, at: at + 1 })).toBe(40000);

    const [seen] = await householdLoanStore.list();
    expect(benBook.canEdit(seen)).toBe(false);
    expect(annaBook.canEdit(seen)).toBe(true);
    expect(seen.repayments.map((item) => [benBook.canRemoveRepayment(item), annaBook.canRemoveRepayment(item)])).toEqual([
      [true, false],
      [false, true],
    ]);

    await benBook.edit(loan.id, fields("Voisin", 1));
    await benBook.remove(loan.id);
    await benBook.removeRepayment(seen, seen.repayments[1]);
    expect((await householdLoanStore.list())[0].amountMga).toBe(60000);
    expect((await householdLoanStore.list())[0].repayments).toHaveLength(2);

    await annaBook.remove(loan.id);
    expect(await householdLoanStore.list()).toHaveLength(0);
  });

  it("syncs under the RLS: one's own rows pushed, the others' pulled with their author, a malformed one skipped", async () => {
    server.rows.push(
      { household_id: home, id: "b-loan", user_id: ben, data: { kind: "loan", direction: "borrowed", person: "Tante", amountMga: 40000, at, createdAt: at }, updated_at: new Date(at).toISOString(), deleted_at: null },
      { household_id: home, id: "b-bad", user_id: ben, data: { kind: "loan", person: "", amountMga: "beaucoup" }, updated_at: new Date(at).toISOString(), deleted_at: null },
      { household_id: "elsewhere", id: "c-loan", user_id: ben, data: { kind: "loan", direction: "lent", person: "X", amountMga: 1, at, createdAt: at }, updated_at: new Date(at).toISOString(), deleted_at: null },
    );
    const annaBook = householdBook(anna);
    const mine = (await annaBook.create(fields("Voisin", 60000)))!;
    // Not signed in as Anna: the RLS refuses her rows.
    server.as = "";
    await expect(syncHouseholdLoans(anna, home)).rejects.toBeTruthy();
    server.as = anna;
    await syncHouseholdLoans(anna, home);
    const loans = await householdLoanStore.list();
    expect(loans.map((item) => item.id).sort()).toEqual(["b-loan", mine.id].sort());
    expect(loans.find((item) => item.id === "b-loan")?.userId).toBe(ben);

    // Anna notes a repayment on Ben's loan: a row of her own.
    await annaBook.addRepayment("b-loan", { amountMga: 15000, at });
    await syncHouseholdLoans(anna, home);
    const pushed = server.rows.filter((row) => row.user_id === anna).map((row) => row.data.kind).sort();
    expect(pushed).toEqual(["loan", "repayment"]);
    // Ben's row was never written by Anna's device.
    expect(server.rows.find((row) => row.id === "b-loan")?.data.amountMga).toBe(40000);
  });

  it("keeps a repayment whose author deleted their account: shown with its name, changed by nobody", async () => {
    server.as = anna;
    const annaBook = householdBook(anna, "Anna");
    const mine = (await annaBook.create(fields("Voisin", 60000)))!;
    server.rows.push({ household_id: home, id: "gone-1", user_id: null, data: { kind: "repayment", loanId: mine.id, at, amountMga: 5000, authorName: "Rasoa" }, updated_at: new Date(at).toISOString(), deleted_at: null });
    await syncHouseholdLoans(anna, home);
    await annaBook.addRepayment(mine.id, { amountMga: 1000, at: at + 1 });
    const [loan] = await householdLoanStore.list();
    expect(loan.repayments.map((item) => [item.amountMga, item.authorName])).toEqual([
      [5000, "Rasoa"],
      [1000, "Anna"],
    ]);
    expect(annaBook.canRemoveRepayment(loan.repayments[0])).toBe(false);
    await annaBook.removeRepayment(loan, loan.repayments[0]);
    await syncHouseholdLoans(anna, home);
    expect(server.rows.find((row) => row.id === "gone-1")?.user_id).toBeNull();
    expect((await householdLoanStore.list())[0].repayments).toHaveLength(2);
  });

  it("gives one's own loans back on leaving, with every repayment; the others' go", async () => {
    const mine = (await householdBook(anna).create(fields("Voisin", 60000)))!;
    await householdBook(ben).addRepayment(mine.id, { amountMga: 20000, at });
    const theirs = (await householdBook(ben).create(fields("Tante", 10000)))!;
    await detachHouseholdLoans(anna);

    expect(await householdLoanStore.list()).toHaveLength(0);
    const personal = await loanStore.list();
    expect(personal.map((item) => item.id)).toEqual([mine.id]);
    expect(personal[0].repayments).toEqual([expect.objectContaining({ amountMga: 20000 })]);
    expect(personal[0]).not.toHaveProperty("userId");
    expect(personal.some((item) => item.id === theirs.id)).toBe(false);
  });
});
