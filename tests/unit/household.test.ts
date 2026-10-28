import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptSharedExpense,
  formatInviteCode,
  HouseholdActionSchema,
  householdErrorKey,
  householdErrorOf,
  householdFromState,
  householdMonth,
  INVITE_ALPHABET,
  maskEmail,
  memberLabel,
  normalizeInviteCode,
  sharedCategory,
  type HouseholdExpense,
} from "@/lib/household";
import { expenseStore } from "@/services/expenseStore";
import { detachHousehold, householdExpenseStore, saveExpenseIn } from "@/services/householdExpenseStore";

// The route's dependencies: the account and its plan, and the database functions.
const state = vi.hoisted(() => ({
  plan: "unlimited" as string,
  account: true as boolean,
  accountId: "11111111-1111-4111-8111-111111111111",
  calls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  fail: null as string | null,
  household: null as unknown,
  // What GET /api/household answers the app.
  served: null as unknown,
}));
vi.mock("@/services/account", () => ({ authHeaders: async () => ({}) }));
vi.mock("@/services/httpClient", () => ({ httpClient: { get: async () => state.served, post: async () => state.served } }));
vi.mock("@/lib/server/redis", () => ({ redis: null }));
vi.mock("@/lib/server/plan", () => ({
  resolvePlan: async () => {
    const { defaultPlansConfig, effectiveFeatures } = await import("@/lib/plans");
    type PlanId = Parameters<typeof effectiveFeatures>[0]["plan"];
    return {
      account: state.account ? { id: state.accountId, email: "a@example.com" } : null,
      current: { plan: state.plan, endsAt: null },
      features: effectiveFeatures({ plan: state.plan as PlanId, email: "a@example.com", config: defaultPlansConfig }),
    };
  },
}));
vi.mock("@/lib/server/supabaseAdmin", () => ({
  accountsEnabled: true,
  supabaseAdmin: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.calls.push({ fn, args });
      if (fn === "household_state") return { data: state.household, error: null };
      if (state.fail) return { data: null, error: { message: state.fail, code: "P0001" } };
      return { data: null, error: null };
    },
  }),
}));

const { default: householdRoute } = await import("@/pages/api/household");
const { householdStore } = await import("@/services/household");

const me = "11111111-1111-4111-8111-111111111111";
const ben = "22222222-2222-4222-8222-222222222222";
const day = (date: number, month = 9) => new Date(2026, month, date, 12).getTime();
const shared = (id: string, amountMga: number, category: string, userId?: string, at = day(10)): HouseholdExpense => ({
  kind: "expense",
  id,
  at,
  amountMga,
  category,
  userId,
  createdAt: at,
  updatedAt: at,
});

describe("invitation codes", () => {
  it("uses the same 26 signs as the database, without look-alikes", () => {
    const migration = readFileSync("supabase/migrations/0009_households.sql", "utf8");
    expect(migration).toContain(`'${INVITE_ALPHABET}'`);
    expect(migration).toContain(`[${INVITE_ALPHABET}]{6}`);
    expect(INVITE_ALPHABET).toHaveLength(26);
    for (const lookAlike of ["0", "O", "1", "I", "L", "5", "S", "8", "B", "Z"]) expect(INVITE_ALPHABET).not.toContain(lookAlike);
  });

  it("reads a code typed in any case, with a dash or spaces", () => {
    expect(normalizeInviteCode("4k7-p2q")).toBe("4K7P2Q");
    expect(normalizeInviteCode(" 4K7 P2Q ")).toBe("4K7P2Q");
    expect(formatInviteCode("4K7P2Q")).toBe("4K7-P2Q");
  });

  it("refuses what can't be a code", () => {
    expect(normalizeInviteCode("4K7P2")).toBeNull();
    expect(normalizeInviteCode("4K7P2QQ")).toBeNull();
    // O and 1 are never in a code.
    expect(normalizeInviteCode("4K7O21")).toBeNull();
  });
});

describe("members", () => {
  it("shows a first name, else a masked e-mail", () => {
    expect(maskEmail("rakoto.jean@gmail.com")).toBe("ra…@gmail.com");
    expect(maskEmail("a@b.mg")).toBe("a…@b.mg");
    expect(maskEmail(null)).toBe("…");
    expect(memberLabel({ email: "rakoto.jean@gmail.com", name: "Jean Rakoto" })).toBe("Jean");
    expect(memberLabel({ email: "rakoto.jean@gmail.com", name: " " })).toBe("ra…@gmail.com");
  });

  it("never passes a full e-mail from the database to the app", () => {
    const household = householdFromState({
      id: "h1",
      ownerId: me,
      role: "owner",
      data: { name: "Famille Rabe", budget: { total: 500000, categories: { market: 200000 } } },
      updatedAt: "2026-10-28T08:00:00Z",
      members: [
        { userId: me, role: "owner", joinedAt: "2026-10-28T08:00:00Z", email: "anna.rabe@example.com", name: null },
        { userId: ben, role: "member", joinedAt: "2026-10-28T09:00:00Z", email: "ben@example.com", name: "Ben Rabe" },
      ],
      invite: { code: "4K7P2Q", expiresAt: "2026-10-30T08:00:00Z" },
    });
    expect(household).toMatchObject({ name: "Famille Rabe", role: "owner", budget: { total: 500000, categories: { market: 200000 } }, invite: { code: "4K7P2Q" } });
    expect(household?.members.map((member) => member.label)).toEqual(["an…@example.com", "Ben"]);
    expect(JSON.stringify(household)).not.toContain("anna.rabe@");
    expect(householdFromState(null)).toBeNull();
  });
});

describe("the household's month", () => {
  const expenses = [
    shared("a", 30000, "market", me),
    shared("b", 45000, "jirama", ben),
    shared("c", 20000, "market", ben),
    // Written here, not synced yet: the user's.
    shared("d", 5000, "transport"),
    // Another month, and a removed one: not counted.
    shared("e", 99000, "market", me, day(10, 8)),
    { ...shared("f", 77000, "market", ben), deletedAt: day(11) },
  ];

  it("adds up every member's shared expenses, by category and by member", () => {
    const view = householdMonth(expenses, "2026-10", undefined, me);
    expect(view.totals.total).toBe(100000);
    expect(view.totals.byCategory).toEqual([
      { category: "market", amount: 50000 },
      { category: "jirama", amount: 45000 },
      { category: "transport", amount: 5000 },
    ]);
    expect(view.byMember).toEqual([
      { userId: ben, amount: 65000 },
      { userId: me, amount: 35000 },
    ]);
    expect(view.items.map((item) => item.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("warns at 80 % of the shared budget, then over it", () => {
    expect(householdMonth(expenses, "2026-10", { total: 120000, categories: {} }, me).budget[0]).toMatchObject({ scope: "total", level: "warning" });
    const over = householdMonth(expenses, "2026-10", { total: 200000, categories: { jirama: 40000 } }, me).budget;
    expect(over.map((line) => [line.scope, line.level])).toEqual([
      ["total", "ok"],
      ["jirama", "over"],
    ]);
  });

  it("keeps shared expenses in the built-in categories", () => {
    expect(sharedCategory("market")).toBe("market");
    expect(sharedCategory("custom-123")).toBe("other");
  });
});

describe("personal or household, never both", () => {
  beforeEach(async () => {
    await expenseStore.wipe();
    await householdExpenseStore.wipe();
    expenseStore.setKeepTombstones(true);
    householdExpenseStore.setKeepTombstones(true);
  });

  const draft = { at: day(12), amountMga: 12000, category: "market", note: "Tsena" };

  it("moves an expense to the household and back, without a copy left behind", async () => {
    const personal = await saveExpenseIn("personal", null, draft, me);
    expect(await expenseStore.list()).toHaveLength(1);

    const moved = await saveExpenseIn("household", "personal", { ...draft, id: personal!.id }, me);
    expect(moved?.id).toBe(personal!.id);
    expect(await expenseStore.list()).toHaveLength(0);
    expect(await householdExpenseStore.list()).toMatchObject([{ id: personal!.id, amountMga: 12000, userId: me }]);
    // The personal one leaves a tombstone, so the removal reaches the account.
    expect((await expenseStore.raw()).find((record) => record.id === personal!.id)?.deletedAt).toBeTruthy();

    await saveExpenseIn("personal", "household", { ...draft, id: personal!.id, amountMga: 15000 }, me);
    expect(await householdExpenseStore.list()).toHaveLength(0);
    expect(await expenseStore.list()).toMatchObject([{ id: personal!.id, amountMga: 15000 }]);
  });

  it("drops the link to a bill when shared, and its own category", async () => {
    const saved = await saveExpenseIn("household", null, { ...draft, category: "custom-1", sourceKey: "bill:scan-1" }, me);
    expect(saved).toMatchObject({ category: "other" });
    expect(saved).not.toHaveProperty("sourceKey");
  });

  it("never changes another member's expense", async () => {
    await householdExpenseStore.rawPut(shared("ben-1", 45000, "jirama", ben));
    expect(await householdExpenseStore.save({ ...draft, id: "ben-1" }, me)).toBeNull();
    expect((await householdExpenseStore.list())[0]).toMatchObject({ amountMga: 45000 });
  });

  it("out of the household, brings one's own back and drops the others'", async () => {
    await householdExpenseStore.rawPut(shared("mine-1", 30000, "market", me));
    await householdExpenseStore.rawPut(shared("mine-2", 5000, "transport"));
    await householdExpenseStore.rawPut(shared("ben-1", 45000, "jirama", ben));
    await detachHousehold(me);
    expect(await householdExpenseStore.raw()).toHaveLength(0);
    const back = await expenseStore.list();
    expect(back.map((record) => record.id).sort()).toEqual(["mine-1", "mine-2"]);
    expect(back[0]).not.toHaveProperty("userId");
  });
});

describe("the household on the device", () => {
  const info = (id: string) => ({ id, name: "Famille", role: "member", budget: { categories: {} }, members: [], invite: null });

  it("gives one's shared expenses back once out of the household, and keeps them while in it", async () => {
    await householdExpenseStore.wipe();
    await expenseStore.wipe();
    state.served = { userId: me, household: info("h1") };
    await householdStore.refresh();
    await householdExpenseStore.rawPut(shared("mine-1", 30000, "market", me));
    await householdExpenseStore.rawPut(shared("ben-1", 45000, "jirama", ben));

    await householdStore.refresh();
    expect(await householdExpenseStore.list()).toHaveLength(2);
    expect(householdStore.get()?.household?.id).toBe("h1");

    // Removed by the owner: seen at the next refresh.
    state.served = { userId: me, household: null };
    await householdStore.refresh();
    expect(await householdExpenseStore.list()).toHaveLength(0);
    expect((await expenseStore.list()).map((record) => record.id)).toEqual(["mine-1"]);
  });

  it("drops another household's expenses when the account is now in a new one", async () => {
    await householdExpenseStore.wipe();
    state.served = { userId: me, household: info("h1") };
    await householdStore.refresh();
    await householdExpenseStore.rawPut(shared("ben-1", 45000, "jirama", ben));
    state.served = { userId: me, household: info("h2") };
    await householdStore.refresh();
    expect(await householdExpenseStore.list()).toHaveLength(0);
  });

  it("stays as it was offline, marked stale", async () => {
    state.served = { userId: me, household: info("h1") };
    await householdStore.refresh();
    state.served = Promise.reject(new Error("offline"));
    (state.served as Promise<unknown>).catch(() => undefined);
    await householdStore.refresh();
    expect(householdStore.get()).toMatchObject({ household: { id: "h1" }, stale: true });
  });
});

describe("household route", () => {
  async function call(payload: unknown, method = "POST") {
    const req = { method, headers: {}, body: payload, socket: { remoteAddress: `10.2.0.${Math.floor(Math.random() * 250)}` } } as unknown as NextApiRequest;
    const res = {
      statusCode: 200,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(value: unknown) {
        this.body = value;
        return this;
      },
      setHeader() {},
      end() {},
    };
    await householdRoute(req, res as unknown as NextApiResponse);
    return res as { statusCode: number; body: { error?: { code: string }; household?: unknown; userId?: string } };
  }

  beforeEach(() => {
    state.calls = [];
    state.fail = null;
    state.plan = "unlimited";
    state.account = true;
  });

  it("needs an account", async () => {
    state.account = false;
    const response = await call(undefined, "GET");
    expect(response.statusCode).toBe(401);
    expect(response.body.error?.code).toBe("sign_in_required");
  });

  it("lets only the Admin plan create a household, any account join one", async () => {
    state.plan = "premium";
    expect((await call({ action: "create", name: "Famille" })).body.error?.code).toBe("plan_required");
    expect(state.calls.some((entry) => entry.fn === "create_household")).toBe(false);
    expect((await call({ action: "join", code: "4k7-p2q" })).statusCode).toBe(200);
    expect(state.calls.find((entry) => entry.fn === "join_household")?.args).toEqual({ p_user: me, p_code: "4K7P2Q" });

    state.plan = "unlimited";
    expect((await call({ action: "create", name: "Famille" })).statusCode).toBe(200);
    expect(state.calls.find((entry) => entry.fn === "create_household")?.args).toEqual({ p_user: me, p_name: "Famille" });
  });

  it("explains a refused code", async () => {
    state.fail = "expired";
    expect(await call({ action: "join", code: "4K7P2Q" })).toMatchObject({ statusCode: 410, body: { error: { code: "expired" } } });
    state.fail = "invalid_code";
    expect((await call({ action: "join", code: "4K7P2Q" })).body.error?.code).toBe("invalid_code");
    state.fail = "already_member";
    expect((await call({ action: "create", name: "Encore" })).statusCode).toBe(409);
  });

  it("limits the codes tried to 10 an hour", async () => {
    state.fail = "invalid_code";
    state.accountId = "33333333-3333-4333-8333-333333333333";
    const codes: string[] = [];
    for (let index = 0; index < 11; index += 1) codes.push((await call({ action: "join", code: "4K7P2Q" })).body.error?.code ?? "");
    state.accountId = me;
    expect(codes.slice(0, 10).every((code) => code === "invalid_code")).toBe(true);
    expect(codes[10]).toBe("rate_limited");
  });

  it("refuses the owner's tools without a household, and bad requests", async () => {
    state.household = null;
    expect((await call({ action: "invite" })).body.error?.code).toBe("not_member");
    expect((await call({ action: "update", budget: { categories: { unknown: 5 } } })).statusCode).toBe(400);
    expect((await call({ action: "remove", userId: "not-a-uuid" })).statusCode).toBe(400);
    expect((await call(undefined, "DELETE")).statusCode).toBe(405);
  });
});

describe("household errors", () => {
  it("maps the database's words, and has a message for each", () => {
    expect(householdErrorOf('P0001: expired')).toMatchObject({ status: 410, code: "expired" });
    expect(householdErrorOf("something else")).toBeNull();
    expect(householdErrorKey("invalid_code")).toBe("expenses.household.errors.invalid_code");
    expect(householdErrorKey("upstream_error")).toBe("expenses.household.errors.failed");
  });

  it("validates the owner's budget", () => {
    expect(HouseholdActionSchema.safeParse({ action: "update", budget: { total: 500000, categories: { market: 200000 } } }).success).toBe(true);
    expect(HouseholdActionSchema.safeParse({ action: "update", budget: { total: -1, categories: {} } }).success).toBe(false);
    expect(HouseholdActionSchema.safeParse({ action: "create", name: "  " }).success).toBe(false);
  });
});

describe("acceptSharedExpense", () => {
  const good = { id: "e1", kind: "expense", createdAt: 1, updatedAt: 2, at: Date.UTC(2026, 9, 27), amountMga: 25000, category: "market", userId: "u2", dirty: false };

  it("keeps a well-formed expense and drops unknown fields", () => {
    const accepted = acceptSharedExpense({ ...good, extra: "x".repeat(10_000) });
    expect(accepted).toMatchObject(good);
    expect(accepted).not.toHaveProperty("extra");
  });

  it("skips what another member's device should never write", () => {
    expect(acceptSharedExpense({ ...good, amountMga: -5 })).toBeNull();
    expect(acceptSharedExpense({ ...good, amountMga: Number.POSITIVE_INFINITY })).toBeNull();
    expect(acceptSharedExpense({ ...good, amountMga: "25000" })).toBeNull();
    expect(acceptSharedExpense({ ...good, kind: "income" })).toBeNull();
    expect(acceptSharedExpense({ ...good, at: Date.UTC(1990, 0, 1) })).toBeNull();
    expect(acceptSharedExpense({ ...good, note: "x".repeat(501) })).toBeNull();
    expect(acceptSharedExpense({ ...good, payment: "cheque" })).toBeNull();
  });
});
