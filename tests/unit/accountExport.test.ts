import type { NextApiRequest, NextApiResponse } from "next";
import { describe, expect, it, vi } from "vitest";

// "Télécharger une copie de mes données": the account's part, read by the
// server. A stand-in for Supabase holds the rows of two accounts (and of
// another member of the same household); the route must give only one's own.
const db = vi.hoisted(() => ({
  account: null as { id: string; email: string | null } | null,
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  reads: [] as Array<{ table: string; columns: string; filters: Array<[string, unknown]> }>,
}));
vi.mock("@/lib/server/redis", () => ({ redis: null }));
vi.mock("@/lib/server/supabaseAdmin", () => ({
  accountsEnabled: true,
  verifyAccount: async () => db.account,
  supabaseAdmin: () => ({
    from: (table: string) => ({
      select: (columns: string) => {
        const filters: Array<[string, unknown]> = [];
        const query = {
          eq(column: string, value: unknown) {
            filters.push([column, value]);
            return query;
          },
          async limit() {
            db.reads.push({ table, columns, filters });
            const rows = (db.tables[table] ?? []).filter((row) => filters.every(([column, value]) => row[column] === value));
            // Only the columns asked, like PostgREST.
            const keep = columns.split(",").map((column) => column.trim());
            return { data: rows.map((row) => Object.fromEntries(keep.map((column) => [column, row[column]]))), error: null };
          },
        };
        return query;
      },
    }),
  }),
}));

const { default: route } = await import("@/pages/api/account/export");
const { claimTrial, setParent, swapDiscount } = await import("@/lib/server/offerStore");

const me = { id: "u1", email: "rado@example.mg" };
const other = { id: "u2", email: "soa@example.mg" };

db.tables = {
  subscriptions: [
    { email: me.email, plan: "premium", starts_at: "2026-10-01T00:00:00Z", ends_at: "2027-10-01T00:00:00Z", amount_mga: 50000, payment_method: "mvola", payment_ref: "MP123", created_at: "2026-10-01T00:00:00Z", note: "admin-note" },
    { email: other.email, plan: "pro", starts_at: "2026-10-01T00:00:00Z", ends_at: null, amount_mga: 90000, payment_method: "mvola", payment_ref: "OTHER-REF", created_at: "2026-10-01T00:00:00Z", note: null },
  ],
  feature_grants: [{ email: me.email, feature: "loans", starts_at: "2026-10-01T00:00:00Z", ends_at: "2026-12-01T00:00:00Z", note: "grant-note", created_by: "owner@assisteo.mg" }],
  family_seats: [
    { owner_id: me.id, owner_email: me.email, owner_name: "Rado", member_email: "mamy.rabe@gmail.com", created_at: "2026-10-02T00:00:00Z" },
    { owner_id: "u9", owner_email: "boss@example.mg", owner_name: null, member_email: other.email, created_at: "2026-10-02T00:00:00Z" },
  ],
  household_members: [
    { household_id: "h1", user_id: me.id, role: "member", joined_at: "2026-10-03T00:00:00Z" },
    { household_id: "h1", user_id: other.id, role: "owner", joined_at: "2026-10-01T00:00:00Z" },
  ],
  households: [{ id: "h1", data: { name: "Famille Rabe", budget: { total: 400000 } } }],
  household_expenses: [
    { household_id: "h1", user_id: me.id, id: "e1", data: { amountMga: 5000, note: "my-line", userId: me.id }, updated_at: "2026-10-04T00:00:00Z", deleted_at: null },
    { household_id: "h1", user_id: me.id, id: "e2", data: { note: "my-removed-line" }, updated_at: "2026-10-04T00:00:00Z", deleted_at: "2026-10-05T00:00:00Z" },
    { household_id: "h1", user_id: other.id, id: "e3", data: { note: "other-member-line" }, updated_at: "2026-10-04T00:00:00Z", deleted_at: null },
  ],
  household_loans: [{ household_id: "h1", user_id: other.id, id: "l1", data: { person: "other-member-loan" }, updated_at: "2026-10-04T00:00:00Z", deleted_at: null }],
  loan_shares: [
    { token_hash: "a".repeat(64), user_id: me.id, person: "Hery", snapshot: { secret: 1 }, created_at: "2026-10-05T00:00:00Z", updated_at: "2026-10-06T00:00:00Z", revoked_at: null },
    { token_hash: "b".repeat(64), user_id: other.id, person: "other-share", snapshot: {}, created_at: "2026-10-05T00:00:00Z", updated_at: "2026-10-06T00:00:00Z", revoked_at: null },
  ],
  push_devices: [
    { user_id: me.id, device_id: "install-1", token: "fcm-token-secret", platform: "android", scheduled: ["s1@9"], updated_at: "2026-10-07T00:00:00Z" },
    { user_id: other.id, device_id: "install-2", token: "other-token", platform: "web", scheduled: [], updated_at: "2026-10-07T00:00:00Z" },
  ],
};

function call(method = "GET") {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
    end() {
      return this;
    },
    setHeader() {},
  };
  const req = { method, headers: {}, socket: { remoteAddress: `10.9.0.${Math.floor(Math.random() * 200)}` } } as unknown as NextApiRequest;
  return route(req, res as unknown as NextApiResponse).then(() => res);
}

describe("GET /api/account/export", () => {
  it("refuses without an account", async () => {
    db.account = null;
    const res = await call();
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ error: { code: "sign_in_required" } });
    db.account = { id: me.id, email: null };
    expect((await call()).statusCode).toBe(401);
  });

  it("answers GET only", async () => {
    db.account = me;
    expect((await call("POST")).statusCode).toBe(405);
  });

  it("gives only the signed-in account's own data, without a token or an admin note", async () => {
    db.account = me;
    await claimTrial(me.email);
    await setParent(me.email, "parrain.long@gmail.com");
    await swapDiscount(me.email, { code: "BIENVENUE", percent: 20, since: Date.UTC(2026, 9, 1) });
    db.reads = [];
    const res = await call();
    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body).toMatchObject({
      email: me.email,
      plan: { current: "premium", endsAt: "2027-10-01T00:00:00.000Z" },
      subscriptions: [{ plan: "premium", amountMga: 50000, paymentMethod: "mvola", paymentRef: "MP123" }],
      featureGrants: [{ feature: "loans", startsAt: "2026-10-01T00:00:00.000Z", endsAt: "2026-12-01T00:00:00.000Z" }],
      offers: { trialUsed: true, pendingDiscount: { code: "BIENVENUE", percent: 20 }, referredBy: "pa…@gmail.com" },
      familySeats: { given: [{ member: "ma…@gmail.com" }], received: null },
      household: { name: "Famille Rabe", role: "member", expenses: [{ id: "e1", amountMga: 5000, note: "my-line" }], loans: [] },
      loanShareLinks: [{ person: "Hery", active: true }],
      notificationDevices: [{ platform: "android", updatedAt: "2026-10-07T00:00:00.000Z" }],
    });

    const text = JSON.stringify(body);
    for (const secret of ["OTHER-REF", "admin-note", "grant-note", "owner@assisteo.mg", "mamy.rabe", "parrain.long", "other-member-line", "my-removed-line", "other-member-loan", "other-share", "fcm-token-secret", "other-token", "install-1", "aaaa", "400000", "\"u1\"", "\"u2\"", "soa@"]) {
      expect(text).not.toContain(secret);
    }
    // Every read is on the account itself (its id or e-mail), or on its own household.
    for (const read of db.reads) {
      expect(read.filters.length, read.table).toBeGreaterThan(0);
      for (const [column, value] of read.filters) expect([me.id, me.email, "h1"], `${read.table}.${column}`).toContain(value);
      if (read.table.startsWith("household_") && read.table !== "household_members") expect(read.filters).toContainEqual(["user_id", me.id]);
      expect(read.columns).not.toMatch(/token|note|snapshot|scheduled|device_id/);
    }
  });

  it("gives the seat received with the owner's name or masked e-mail", async () => {
    db.account = other;
    const body = (await call()).body as { familySeats: { received: { owner: string } }; household: { role: string; expenses: Array<{ note: string }>; loans: Array<{ person: string }> } };
    expect(body.familySeats.received.owner).toBe("bo…@example.mg");
    expect(body.household.role).toBe("owner");
    expect(body.household.expenses.map((line) => line.note)).toEqual(["other-member-line"]);
    expect(JSON.stringify(body)).not.toContain("my-line");
  });
});
