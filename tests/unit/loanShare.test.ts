import "fake-indexeddb/auto";
import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { acceptSnapshot, isShareToken, sameSnapshot, sharedAsLoan, shareSnapshot, shareTokenFrom, shareUrl, type LoanShareSnapshot } from "@/lib/loanShare";
import { loanRemaining, type Loan } from "@/lib/loans";
import { hashShareToken, newShareToken } from "@/lib/server/loanShares";
import { resetMissing } from "@/lib/server/schemaMissing";
import { ApiError } from "@/types/api";

// The route's dependencies: the account and its plan, a fake loan_shares
// table (the service role), and what the app's client is answered.
type ShareRow = { token_hash: string; user_id: string; person: string; snapshot: unknown; updated_at: string; revoked_at: string | null };
const state = vi.hoisted(() => ({
  plan: "unlimited" as string,
  account: true as boolean,
  accountId: "11111111-1111-4111-8111-111111111111",
  rows: [] as ShareRow[],
  missing: false,
  reports: 0,
  // What the app's POST /api/loans/share gets (services/loanSharing.ts).
  answer: null as (() => unknown) | null,
}));
vi.mock("@/lib/server/redis", () => ({ redis: null }));
vi.mock("@/lib/server/reportError", () => ({
  reportError: async () => {
    state.reports += 1;
  },
}));
vi.mock("@/services/account", () => ({ authHeaders: async () => ({}) }));
vi.mock("@/services/httpClient", () => ({
  httpClient: {
    post: async () => {
      if (!state.answer) throw new Error("no answer");
      return state.answer();
    },
  },
}));
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
    from(table: string) {
      const filters: Array<(row: ShareRow) => boolean> = [];
      let op: { kind: "select"; columns: string } | { kind: "update"; change: Partial<ShareRow> } | { kind: "insert"; row: ShareRow } = { kind: "select", columns: "*" };
      const run = async () => {
        if (state.missing) return { data: null, error: { code: "PGRST205", message: "Could not find the table in the schema cache" } };
        if (table !== "loan_shares") return { data: [], error: null };
        const match = state.rows.filter((row) => filters.every((keep) => keep(row)));
        if (op.kind === "insert") {
          state.rows.push({ ...op.row, revoked_at: op.row.revoked_at ?? null });
          return { data: null, error: null };
        }
        if (op.kind === "update") {
          for (const row of match) Object.assign(row, op.change);
          return { data: match.map((row) => ({ person: row.person })), error: null };
        }
        const columns = op.columns;
        return { data: match.map((row) => (columns.includes("lender") ? { person: row.person, lender: (row.snapshot as { lender?: string }).lender ?? null } : { snapshot: row.snapshot, updated_at: row.updated_at })), error: null };
      };
      const builder = {
        select(columns = "*") {
          if (op.kind === "select") op = { kind: "select", columns };
          return builder;
        },
        update(change: Partial<ShareRow>) {
          op = { kind: "update", change };
          return builder;
        },
        insert(row: ShareRow) {
          op = { kind: "insert", row };
          return builder;
        },
        eq(column: keyof ShareRow, value: unknown) {
          filters.push((row) => row[column] === value);
          return builder;
        },
        is(column: keyof ShareRow, value: unknown) {
          filters.push((row) => (row[column] ?? null) === value);
          return builder;
        },
        limit: () => builder,
        maybeSingle: async () => {
          const { data, error } = await run();
          return { data: (data as unknown[] | null)?.[0] ?? null, error };
        },
        then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => run().then(resolve, reject),
      };
      return builder;
    },
  }),
}));

const { default: shareRoute } = await import("@/pages/api/loans/share");
const { loanSharing } = await import("@/services/loanSharing");

const DAY = 24 * 60 * 60 * 1000;
const at = new Date(2026, 9, 1, 12).getTime();
const loan = (fields: Partial<Loan>): Loan => ({
  id: "l1",
  direction: "lent",
  person: "Rakoto",
  amountMga: 100000,
  at,
  repayments: [],
  updatedAt: at,
  ...fields,
});

describe("the token", () => {
  it("is 128 random bits in base64url, never the same", () => {
    const tokens = new Set(Array.from({ length: 200 }, newShareToken));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(isShareToken(token)).toBe(true);
    expect(Buffer.from([...tokens][0], "base64url")).toHaveLength(16);
  });

  it("is stored as its sha256 only", () => {
    const token = newShareToken();
    const hash = hashShareToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashShareToken(token));
    expect(hash).not.toContain(token);
    expect(hashShareToken(newShareToken())).not.toBe(hash);
  });

  it("is read from the page's address, refused when cut short", () => {
    const token = newShareToken();
    expect(shareTokenFrom(token)).toBe(token);
    expect(shareTokenFrom([token, "x"])).toBe(token);
    expect(shareTokenFrom(undefined)).toBeNull();
    expect(shareTokenFrom(token.slice(0, 10))).toBeNull();
    expect(shareTokenFrom(`${token}<script>`)).toBeNull();
    expect(shareUrl("https://agny.mg/", token)).toBe(`https://agny.mg/pret?t=${token}`);
  });
});

describe("the frozen copy", () => {
  const full = loan({
    phone: "034 12 345 67",
    note: "Pour l'écolage de Fara",
    wallet: "mvola",
    interest: { kind: "percent", value: 10 },
    proofs: [{ id: "p1", kind: "photo", remote: "user/p1.jpg", addedAt: at }],
    schedule: [
      { id: "e1", dueAt: at + 30 * DAY, amountMga: 55000 },
      { id: "e2", dueAt: at + 60 * DAY, amountMga: 55000 },
    ],
    dueAt: at + 60 * DAY,
    repayments: [{ id: "r1", at: at + DAY, amountMga: 20000, note: "Reçu par MVola de rakoto@example.com", wallet: "mvola", sourceKey: "scan:1", scanId: "scan-1" }],
  });
  const others = [
    full,
    loan({ id: "l2", person: "rakotó ", amountMga: 30000, at: at + 2 * DAY }),
    loan({ id: "l3", person: "Soa", phone: "033 00 000 00" }),
    loan({ id: "l4", direction: "borrowed", person: "Rakoto", amountMga: 5000 }),
    loan({ id: "l5", deletedAt: at, amountMga: 9 }),
  ];

  it("holds only the names, amounts, schedule and repayments of that person's loans", () => {
    const snapshot = shareSnapshot(others, "rakoto", "  Anna  Rabe ", at + 3 * DAY)!;
    expect(snapshot.lender).toBe("Anna Rabe");
    expect(snapshot.borrower).toBe("rakotó");
    expect(snapshot.loans).toHaveLength(2);
    expect(snapshot.loans[0]).toEqual({
      amountMga: 100000,
      interestMga: 10000,
      at,
      dueAt: at + 60 * DAY,
      schedule: [
        { dueAt: at + 30 * DAY, amountMga: 55000 },
        { dueAt: at + 60 * DAY, amountMga: 55000 },
      ],
      repayments: [{ at: at + DAY, amountMga: 20000 }],
    });
    const text = JSON.stringify(snapshot);
    for (const secret of ["034", "033", "@", "écolage", "mvola", "scan", "p1", "Soa", "note", "phone", "proof", "wallet"]) expect(text).not.toContain(secret);
  });

  it("is null without a loan lent to them, or without a name to show", () => {
    expect(shareSnapshot(others, "soa", "", at)).toBeNull();
    expect(shareSnapshot(others, "personne", "Anna", at)).toBeNull();
    expect(shareSnapshot([loan({ direction: "borrowed" })], "rakoto", "Anna", at)).toBeNull();
  });

  it("is checked on the server: unknown fields dropped, a malformed copy refused", () => {
    const snapshot = shareSnapshot(others, "rakoto", "Anna", at)!;
    const sneaky = { ...snapshot, phone: "034", loans: snapshot.loans.map((item) => ({ ...item, note: "secret", proofs: [1] })) };
    const kept = acceptSnapshot(sneaky)!;
    expect(JSON.stringify(kept)).not.toMatch(/phone|note|proofs|secret/);
    expect(acceptSnapshot({ ...snapshot, loans: [] })).toBeNull();
    expect(acceptSnapshot({ ...snapshot, lender: "" })).toBeNull();
    expect(acceptSnapshot({ ...snapshot, loans: [{ ...snapshot.loans[0], amountMga: -1 }] })).toBeNull();
  });

  it("tells the same content apart from a change, whatever its time", () => {
    const first = shareSnapshot(others, "rakoto", "Anna", at)!;
    expect(sameSnapshot(first, shareSnapshot(others, "rakoto", "Anna", at + DAY))).toBe(true);
    expect(sameSnapshot(first, shareSnapshot([...others, loan({ id: "l6", amountMga: 1000 })], "rakoto", "Anna", at))).toBe(false);
    expect(sameSnapshot(first, undefined)).toBe(false);
  });

  it("works out what is left as the app does", () => {
    const snapshot = shareSnapshot(others, "rakoto", "Anna", at)!;
    expect(loanRemaining(sharedAsLoan(snapshot.loans[0]))).toBe(loanRemaining(full));
    expect(loanRemaining(sharedAsLoan(snapshot.loans[1]))).toBe(30000);
  });
});

describe("the share route", () => {
  const snapshot: LoanShareSnapshot = shareSnapshot([loan({})], "rakoto", "Anna", at)!;

  async function call({ method = "GET", query = {}, body, ip = `10.3.0.${Math.floor(Math.random() * 250)}` }: { method?: string; query?: Record<string, string>; body?: unknown; ip?: string }) {
    const headers: Record<string, string> = {};
    const req = { method, headers: {}, query, body, socket: { remoteAddress: ip } } as unknown as NextApiRequest;
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
      setHeader(name: string, value: string) {
        headers[name] = value;
      },
      end() {},
    };
    await shareRoute(req, res as unknown as NextApiResponse);
    return { ...(res as { statusCode: number; body: Record<string, unknown> & { error?: { code: string } } }), headers };
  }

  beforeEach(() => {
    state.rows = [];
    state.missing = false;
    state.reports = 0;
    state.plan = "unlimited";
    state.account = true;
    resetMissing();
  });

  it("makes a link, serves its copy alone, then stops it", async () => {
    const created = await call({ method: "POST", body: { action: "create", person: "rakoto", snapshot } });
    expect(created.statusCode).toBe(200);
    const token = created.body.token as string;
    expect(isShareToken(token)).toBe(true);
    // Only the hash is stored.
    expect(JSON.stringify(state.rows)).not.toContain(token);
    expect(state.rows[0].token_hash).toBe(hashShareToken(token));

    // A stored copy with more than it should have: only a copy's fields go out.
    (state.rows[0].snapshot as Record<string, unknown>).phone = "034 12 345 67";
    const read = await call({ query: { t: token } });
    expect(read.statusCode).toBe(200);
    expect(Object.keys(read.body).sort()).toEqual(["snapshot", "updatedAt"]);
    expect(JSON.stringify(read.body)).not.toContain("034");
    expect(read.headers["X-Robots-Tag"]).toBe("noindex");
    expect(read.headers["Cache-Control"]).toBe("no-store");

    expect((await call({ method: "POST", body: { action: "revoke", person: "rakoto" } })).body.found).toBe(true);
    expect((await call({ query: { t: token } })).statusCode).toBe(404);
  });

  it("answers an unknown, a stopped and a malformed link alike", async () => {
    const created = await call({ method: "POST", body: { action: "create", person: "rakoto", snapshot } });
    // A second link for the same person stops the first.
    const again = await call({ method: "POST", body: { action: "create", person: "rakoto", snapshot } });
    const answers = [created.body.token as string, newShareToken(), "short", undefined].map((t) => call({ query: t ? { t } : {} }));
    const responses = await Promise.all(answers);
    for (const response of responses) {
      expect(response.statusCode).toBe(404);
      expect(response.body).toEqual(responses[0].body);
    }
    expect((await call({ query: { t: again.body.token as string } })).statusCode).toBe(200);
  });

  it("limits the pages read per address", async () => {
    const ip = "10.9.9.9";
    const statuses: number[] = [];
    for (let i = 0; i < 31; i += 1) statuses.push((await call({ query: { t: newShareToken() }, ip })).statusCode);
    expect(statuses.slice(0, 30).every((status) => status === 404)).toBe(true);
    expect(statuses[30]).toBe(429);
  });

  it("needs an account with \"Prêts\" to make or change a link", async () => {
    state.account = false;
    expect((await call({ method: "POST", body: { action: "status" } })).body.error?.code).toBe("sign_in_required");
    state.account = true;
    state.plan = "premium";
    expect((await call({ method: "POST", body: { action: "create", person: "rakoto", snapshot } })).body.error?.code).toBe("plan_required");
    expect(state.rows).toHaveLength(0);
  });

  it("updates the copy of the user's own live link only", async () => {
    await call({ method: "POST", body: { action: "create", person: "rakoto", snapshot } });
    state.rows.push({ token_hash: "b".repeat(64), user_id: "someone-else", person: "rakoto", snapshot, updated_at: "", revoked_at: null });
    const changed = { ...snapshot, loans: [{ ...snapshot.loans[0], repayments: [{ at: at + DAY, amountMga: 1000 }] }] };
    expect((await call({ method: "POST", body: { action: "update", person: "rakoto", snapshot: changed } })).body.found).toBe(true);
    expect((state.rows[0].snapshot as LoanShareSnapshot).loans[0].repayments).toHaveLength(1);
    expect((state.rows[1].snapshot as LoanShareSnapshot).loans[0].repayments).toHaveLength(0);
    const status = await call({ method: "POST", body: { action: "status" } });
    expect(status.body).toEqual({ ready: true, household: true, shares: [{ person: "rakoto", lender: "Anna" }] });
  });

  it("works before migration 0012: a 404, \"not ready\", and one report only", async () => {
    state.missing = true;
    expect((await call({ query: { t: newShareToken() } })).statusCode).toBe(404);
    expect((await call({ method: "POST", body: { action: "status" } })).body).toEqual({ ready: false, household: false, shares: [] });
    expect((await call({ method: "POST", body: { action: "create", person: "rakoto", snapshot } })).body.error?.code).toBe("unavailable");
    expect((await call({ query: { t: newShareToken() } })).statusCode).toBe(404);
    // One per missing table, however many requests.
    expect(state.reports).toBe(2);
  });
});

describe("sharing on the device", () => {
  it("says \"bientôt disponible\" before the migration, without throwing", async () => {
    state.answer = () => ({ ready: false, household: false, shares: [] });
    await loanSharing.ensure("user-1", true);
    expect(loanSharing.get()).toEqual({ kind: "soon", household: false });
    state.answer = () => {
      throw new ApiError("Request failed", 503, { error: { code: "unavailable", message: "" } });
    };
    await loanSharing.ensure("user-2", true);
    expect(loanSharing.get().kind).toBe("soon");
    await loanSharing.refresh([loan({})]);
  });

  it("keeps the token of a link made here, and forgets it when stopped", async () => {
    state.answer = () => ({ ready: true, household: true, shares: [] });
    await loanSharing.ensure("user-3", true);
    const token = newShareToken();
    state.answer = () => ({ token });
    const url = await loanSharing.create("rakoto", "Anna", [loan({})]);
    expect(url).toContain(`/pret?t=${token}`);
    expect(await loanSharing.link("rakoto")).toBe(url);
    state.answer = () => ({ ok: true, found: true });
    await loanSharing.stop("rakoto");
    expect(await loanSharing.link("rakoto")).toBeNull();
    expect(await loanSharing.localShares()).toHaveLength(0);
  });
});
