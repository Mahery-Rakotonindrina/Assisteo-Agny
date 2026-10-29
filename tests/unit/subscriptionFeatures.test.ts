import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { describeOwn, keepRunningRights, setPlanFeatures, toggleOwnFeature } from "@/lib/featureChanges";
import {
  defaultFeatureSettings,
  deepFallbackLimit,
  defaultPlansConfig,
  effectiveFeatures,
  featureOrigins,
  keptDiff,
  normalizeDiff,
  normalizeQuotas,
  planFeatures,
  planIds,
  subscriptionDeepWithoutLimit,
  withDeepFallback,
  withQuotas,
  type FeatureSettings,
  type PlanFeature,
} from "@/lib/plans";
import { paidReminderUsers } from "@/lib/server/reminderPush";

// A stand-in for Supabase: each query is answered by `fake.respond`, which
// sees the table and every call made on it (select, eq, insert…).
const fake = vi.hoisted(() => {
  type Op = [string, unknown[]];
  const state = {
    calls: [] as Array<{ table: string; ops: Op[] }>,
    respond: (_table: string, _ops: Op[]): { data: unknown; error: { message: string; code?: string } | null } => ({ data: [], error: null }),
  };
  const builder = (table: string) => {
    const ops: Op[] = [];
    state.calls.push({ table, ops });
    const chain: Record<string | symbol, unknown> = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") return (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(state.respond(table, ops)).then(resolve, reject);
          return (...args: unknown[]) => {
            ops.push([String(prop), args]);
            return chain;
          };
        },
      },
    );
    return chain;
  };
  return { state, builder };
});

vi.mock("@/lib/server/redis", () => ({ redis: null }));
vi.mock("@/lib/server/reportError", () => ({ reportError: vi.fn(async () => undefined) }));
vi.mock("@/lib/server/supabaseAdmin", () => ({ accountsEnabled: true, supabaseAdmin: () => ({ from: fake.builder }), verifyAccount: async () => null }));

const clone = (settings: FeatureSettings): FeatureSettings => JSON.parse(JSON.stringify(settings)) as FeatureSettings;
const NOW = Date.parse("2026-11-01T12:00:00Z");
const config = defaultPlansConfig;
const has = (input: Parameters<typeof effectiveFeatures>[0]) => [...effectiveFeatures({ now: NOW, ...input })].sort();

describe("no setting of its own: nothing changes (lot A)", () => {
  it("gives every plan exactly the features of its plan", () => {
    for (const plan of planIds) {
      const before = [...effectiveFeatures({ plan, email: "a@example.com", config })].sort();
      expect(has({ plan, email: "a@example.com", config, subscription: null, grants: [] }), plan).toEqual(before);
      expect(has({ plan, email: "a@example.com", config, subscription: { features: null }, grants: [] }), plan).toEqual(before);
      expect(featureOrigins({ plan, config, now: NOW }).every((line) => line.kind === (line.on ? "plan" : "notInPlan")), plan).toBe(true);
    }
  });

  it("keeps the plan's limits", () => {
    expect(withQuotas("premium", config.offers.premium, null)).toEqual(config.offers.premium);
    expect(normalizeQuotas(config.offers.premium, { scans: 300 })).toBeNull();
    expect(normalizeDiff(config.features.premium, { add: ["garage"], remove: ["reseller"] })).toBeNull();
  });
});

describe("a subscription's own features and offered ones", () => {
  it("adds and removes on top of the plan", () => {
    const own = { features: { add: ["reseller" as PlanFeature], remove: ["garage" as PlanFeature] } };
    const premium = has({ plan: "premium", config, subscription: own });
    expect(premium).toContain("reseller");
    expect(premium).not.toContain("garage");
  });

  it("counts an offer only while it runs", () => {
    const grant = { feature: "garage" as const, startsAt: "2026-10-30T00:00:00Z", endsAt: "2026-11-06T00:00:00Z" };
    expect(has({ plan: "free", config, grants: [grant] })).toEqual(["garage"]);
    expect(has({ plan: "free", config, grants: [grant], now: Date.parse("2026-11-06T00:00:00Z") })).toEqual([]);
    expect(has({ plan: "free", config, grants: [{ ...grant, startsAt: "2026-11-02T00:00:00Z" }] })).toEqual([]);
    // An offer wins over a feature removed by hand.
    expect(has({ plan: "premium", config, subscription: { features: { add: [], remove: ["garage"] } }, grants: [grant] })).toContain("garage");
  });

  it("drops what lacks a need, and keeps the states first", () => {
    expect(has({ plan: "free", config, subscription: { features: { add: ["reseller"], remove: [] } } })).toEqual([]);
    const off = clone(defaultFeatureSettings);
    off.featureStatus.garage = { mode: "off", testers: [] };
    expect(has({ plan: "free", config: off, grants: [{ feature: "garage", startsAt: "2026-10-30T00:00:00Z", endsAt: "2026-12-01T00:00:00Z" }] })).toEqual([]);
    const test = clone(defaultFeatureSettings);
    test.featureStatus.garage = { mode: "test", testers: ["rado@example.com"] };
    expect(has({ plan: "lite", email: "other@example.com", config: test, subscription: { features: { add: ["garage"], remove: [] } } })).not.toContain("garage");
    expect(has({ plan: "lite", email: "rado@example.com", config: test })).toContain("garage");
  });

  it("gives each feature its origin, for the card", () => {
    const settings = clone(defaultFeatureSettings);
    settings.featureStatus.pdfExport = { mode: "off", testers: [] };
    settings.featureStatus.ownKey = { mode: "test", testers: [] };
    const lines = featureOrigins({
      plan: "premium",
      email: "a@example.com",
      config: settings,
      subscription: { features: { add: ["reseller"], remove: ["garage", "parcelCosts"] } },
      grants: [{ feature: "multiPage", startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-11-13T00:00:00Z" }, { feature: "expenses", startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-11-13T00:00:00Z" }],
      now: NOW,
    });
    const by = Object.fromEntries(lines.map((line) => [line.feature, line]));
    expect(by.reminders).toMatchObject({ kind: "plan", on: true });
    expect(by.garage).toMatchObject({ kind: "removed", on: false });
    expect(by.reseller).toMatchObject({ kind: "missing", on: false, needs: ["parcelCosts"] });
    expect(by.expenses).toMatchObject({ kind: "grant", on: true, endsAt: "2026-11-13T00:00:00Z" });
    expect(by.multiPage).toMatchObject({ kind: "plan", on: true });
    expect(by.pdfExport).toMatchObject({ kind: "off", on: false });
    expect(by.ownKey).toMatchObject({ kind: "test", on: false });
    expect(by.loans).toMatchObject({ kind: "notInPlan", on: false });
    expect(featureOrigins({ plan: "lite", config, subscription: { features: { add: ["garage"], remove: [] } } }).find((line) => line.feature === "garage")).toMatchObject({ kind: "added", on: true });
    expect(lines.map((line) => line.feature)).toEqual([...planFeatures]);
  });

  it("ticks needs and unticks dependents in the sheet", () => {
    expect(toggleOwnFeature(config.features.lite, null, "reseller", true)).toEqual({ add: ["reseller"], remove: [] });
    expect(toggleOwnFeature(config.features.pro, null, "parcelCosts", false)).toEqual({ add: [], remove: ["parcelCosts", "reseller"] });
    expect(toggleOwnFeature(config.features.pro, { add: [], remove: ["garage"] }, "garage", true)).toBeNull();
    expect(describeOwn({ add: ["garage"], remove: ["pdfExport"] }, { scans: 100 })).toBe("+garage -pdfExport · scans 100");
  });
});

describe("a subscription's own limits", () => {
  it("replaces the plan's where set, Admin left without limits", () => {
    expect(withQuotas("lite", config.offers.lite, { scans: 100, parcels: 15 })).toMatchObject({ scans: 100, parcels: 15, questionsPerDay: 10 });
    expect(withQuotas("unlimited", { scans: 0, questionsPerDay: 0, parcels: 0, deepPerMonth: 0 }, { scans: 5 }).scans).toBe(0);
  });

  it("refuses deep analyses added without a monthly count, Admin aside", () => {
    expect(subscriptionDeepWithoutLimit("lite", config, { add: ["deepAnalysis"], remove: [] }, null)).toBe(true);
    expect(subscriptionDeepWithoutLimit("lite", config, { add: ["deepAnalysis"], remove: [] }, { deepPerMonth: 5 })).toBe(false);
    expect(subscriptionDeepWithoutLimit("premium", config, null, { deepPerMonth: 0 })).toBe(true);
    expect(subscriptionDeepWithoutLimit("premium", config, { add: [], remove: ["deepAnalysis"] }, { deepPerMonth: 0 })).toBe(false);
    expect(subscriptionDeepWithoutLimit("premium", config, null, null)).toBe(false);
    expect(subscriptionDeepWithoutLimit("unlimited", config, { add: ["deepAnalysis"], remove: [] }, null)).toBe(false);
  });
});

describe("only new subscriptions and renewals", () => {
  it("keeps what the running subscriptions have", () => {
    const after = setPlanFeatures(clone(defaultFeatureSettings), "premium", ["garage"], false);
    after.features = setPlanFeatures(after, "premium", ["reseller", "parcelCosts"], true).features;
    expect(keptDiff(config.features.premium, after.features.premium, null)).toEqual({ add: ["garage"], remove: ["reseller"] });
    // Its own difference is kept too.
    expect(keptDiff(config.features.premium, after.features.premium, { add: [], remove: ["pdfExport"] })).toEqual({ add: ["garage"], remove: ["pdfExport", "reseller"] });

    const rows = [
      { id: "1", email: "a@example.com", plan: "premium" as const, startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-12-01T00:00:00Z", features: null },
      { id: "2", email: "b@example.com", plan: "premium" as const, startsAt: "2026-01-01T00:00:00Z", endsAt: "2026-02-01T00:00:00Z", features: null },
      { id: "3", email: "c@example.com", plan: "lite" as const, startsAt: "2026-10-01T00:00:00Z", endsAt: null, features: null },
      // A renewal already running: it is the one that keeps.
      { id: "4", email: "d@example.com", plan: "premium" as const, startsAt: "2026-09-01T00:00:00Z", endsAt: "2026-10-15T00:00:00Z", features: null },
      { id: "5", email: "d@example.com", plan: "premium" as const, startsAt: "2026-10-15T00:00:00Z", endsAt: "2026-11-15T00:00:00Z", features: null },
    ];
    const updates = keepRunningRights(config.features, after.features, rows, NOW);
    expect(updates.map((update) => update.id)).toEqual(["1", "5"]);
    for (const update of updates) {
      const kept = has({ plan: "premium", config: { ...config, ...after }, subscription: update });
      expect(kept).toEqual(has({ plan: "premium", config }));
    }
    expect(keepRunningRights(config.features, config.features, rows, NOW)).toEqual([]);
  });

  it("counts own features and offers for the reminder pushes", () => {
    const users = [
      { id: "u1", email: "a@example.com" },
      { id: "u2", email: "b@example.com" },
    ];
    const rows = [{ email: "a@example.com", plan: "lite" as const, starts_at: "2026-10-01T00:00:00Z", ends_at: null, features: { add: [], remove: ["reminders" as PlanFeature] } }];
    const grants = [{ email: "B@example.com", feature: "reminders" as const, startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-12-01T00:00:00Z" }];
    expect([...paidReminderUsers(users, rows, NOW, defaultFeatureSettings, grants)]).toEqual(["u2"]);
  });
});

describe("the emergency cap on deep analyses", () => {
  const grant = { feature: "deepAnalysis" as const, startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-11-30T00:00:00Z" };

  it("never leaves deep analyses without a limit once the count is back to 0", async () => {
    const { limitsFor, limitsWithCap } = await import("@/lib/server/plan");
    // A Lite offered deep analyses, its own count gone (renewed, or back to the plan).
    const features = effectiveFeatures({ plan: "lite", config, grants: [grant], now: NOW });
    expect(features.has("deepAnalysis")).toBe(true);
    const capped = await limitsWithCap("lite", config, null, features);
    expect(capped).toMatchObject({ fallback: true, limits: { deepPerMonth: 30 } });
    // Its own count, when set, stays.
    expect((await limitsFor("lite", config, { deepPerMonth: 5 }, features)).deepPerMonth).toBe(5);
    // A free account with an offer too; without deep analyses, nothing changes.
    expect((await limitsFor("free", config, null, effectiveFeatures({ plan: "free", config, grants: [grant], now: NOW }))).deepPerMonth).toBe(30);
    expect((await limitsWithCap("lite", config, null, effectiveFeatures({ plan: "lite", config, now: NOW }))).fallback).toBe(false);
    // Admin stays without a limit.
    expect(await limitsWithCap("unlimited", config, null, effectiveFeatures({ plan: "unlimited", config, now: NOW }))).toMatchObject({ fallback: false, limits: { deepPerMonth: 0 } });
  });

  it("takes the smallest count of the paid plans, else 5", () => {
    expect(deepFallbackLimit(config.offers)).toBe(30);
    expect(deepFallbackLimit({ lite: { deepPerMonth: 0 }, premium: { deepPerMonth: 12 }, pro: { deepPerMonth: 8 } })).toBe(8);
    expect(deepFallbackLimit({ lite: { deepPerMonth: 0 }, premium: { deepPerMonth: 0 }, pro: { deepPerMonth: 0 } })).toBe(5);
    expect(withDeepFallback("pro", { scans: 0, questionsPerDay: 0, parcels: 0, deepPerMonth: 0 }, new Set(["deepAnalysis" as const]), config.offers).limits.deepPerMonth).toBe(30);
  });
});

// ---- Server, before and after migration 0011 ------------------------------------

type Respond = typeof fake.state.respond;
const missingColumn = { message: "column subscriptions.features does not exist", code: "42703" };
const missingTable = { message: "Could not find the table 'public.feature_grants' in the schema cache", code: "PGRST205" };
const hasOp = (ops: Array<[string, unknown[]]>, name: string, match?: (args: unknown[]) => boolean) => ops.some(([op, args]) => op === name && (!match || match(args)));

beforeEach(async () => {
  const { resetMissing } = await import("@/lib/server/schemaMissing");
  resetMissing();
  fake.state.calls = [];
});

describe("before migration 0011", () => {
  const before: Respond = (table, ops) => {
    if (table === "feature_grants") return { data: null, error: missingTable };
    const wantsOwn = hasOp(ops, "select", (args) => String(args[0]).includes("features")) || hasOp(ops, "insert", (args) => JSON.stringify(args[0]).includes("features"));
    if (wantsOwn) return { data: null, error: missingColumn };
    return { data: [{ id: "s1", email: "a@example.com", plan: "premium", starts_at: "2026-10-01T00:00:00Z", ends_at: null }], error: null };
  };

  it("reads the plan alone, offers as none, and says so once", async () => {
    fake.state.respond = before;
    const { accessForEmail } = await import("@/lib/server/subscriptions");
    const { currentGrantsForEmail } = await import("@/lib/server/featureGrants");
    const { reportError } = await import("@/lib/server/reportError");
    vi.mocked(reportError).mockClear();
    expect(await accessForEmail("a@example.com", NOW)).toEqual({ current: { plan: "premium", endsAt: null }, subscription: { id: "s1", features: null, quotas: null } });
    expect(await currentGrantsForEmail("a@example.com", NOW)).toEqual([]);
    // Next time, the missing pieces aren't asked again.
    fake.state.calls = [];
    await accessForEmail("a@example.com", NOW);
    expect(await currentGrantsForEmail("a@example.com", NOW)).toEqual([]);
    expect(fake.state.calls.map((call) => call.table)).toEqual(["subscriptions"]);
    expect(vi.mocked(reportError)).toHaveBeenCalledTimes(2);
  });

  it("saves a subscription without its own settings, refuses one with them", async () => {
    fake.state.respond = before;
    const { addSubscriptions } = await import("@/lib/server/subscriptions");
    const { MigrationNeededError } = await import("@/lib/server/schemaMissing");
    const input = { email: "a@example.com", plan: "premium" as const, startsAt: "2026-10-01T00:00:00Z", endsAt: null, amountMga: null, paymentMethod: null, paymentRef: null, note: null };
    expect(await addSubscriptions([{ ...input, features: null, quotas: null }])).toHaveLength(1);
    await expect(addSubscriptions([{ ...input, features: { add: ["reseller", "parcelCosts"], remove: [] } }])).rejects.toBeInstanceOf(MigrationNeededError);
  });
});

describe("after migration 0011", () => {
  it("applies the running subscription's own settings and the offers running now", async () => {
    fake.state.respond = (table) =>
      table === "feature_grants"
        ? { data: [{ id: "g1", email: "a@example.com", feature: "garage", starts_at: "2026-10-30T00:00:00Z", ends_at: "2026-11-13T00:00:00Z", note: null, created_by: "owner", created_at: "2026-10-30T00:00:00Z" }], error: null }
        : { data: [{ id: "s1", email: "a@example.com", plan: "lite", starts_at: "2026-10-01T00:00:00Z", ends_at: null, features: { add: [], remove: ["pdfExport"] }, quotas: { scans: 100 } }], error: null };
    const { accessForEmail } = await import("@/lib/server/subscriptions");
    const { currentGrantsForEmail } = await import("@/lib/server/featureGrants");
    const access = await accessForEmail("a@example.com", NOW);
    const grants = await currentGrantsForEmail("a@example.com", NOW);
    const features = has({ plan: access.current.plan, config, subscription: access.subscription, grants });
    expect(features).toContain("garage");
    expect(features).not.toContain("pdfExport");
    const { limitsFor } = await import("@/lib/server/plan");
    expect((await limitsFor("lite", config, access.subscription?.quotas)).scans).toBe(100);
  });
});

describe("Admin → an account's card", () => {
  process.env.ADMIN_TOKEN = "admin-token-for-tests-0123456789";

  async function call(method: string, { body, query, token = process.env.ADMIN_TOKEN }: { body?: unknown; query?: Record<string, string>; token?: string } = {}) {
    const { default: handler } = await import("@/pages/api/admin/account");
    const req = { method, body, query: query ?? {}, headers: token ? { authorization: `Bearer ${token}` } : {}, socket: { remoteAddress: "10.1.2.4" } } as unknown as NextApiRequest;
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
      end() {
        return this;
      },
      setHeader() {},
    };
    await handler(req, res as unknown as NextApiResponse);
    return res;
  }

  const inFuture = (days: number) => new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
  const grantRow = (overrides: Record<string, unknown> = {}) => ({
    id: "8d0a3f8e-5f8b-4b8e-9a51-7b0d7c5e2a10",
    email: "free@example.com",
    feature: "garage",
    starts_at: new Date().toISOString(),
    ends_at: inFuture(7),
    note: "Essai",
    created_by: "owner",
    created_at: new Date().toISOString(),
    ...overrides,
  });

  it("refuses without the admin token and checks what it is sent", async () => {
    fake.state.respond = () => ({ data: [], error: null });
    expect((await call("GET", { query: { email: "a@example.com" }, token: "wrong" })).statusCode).toBe(401);
    expect((await call("GET", { query: { email: "not an e-mail" } })).statusCode).toBe(400);
    expect((await call("POST", { body: { email: "a@example.com", feature: "teleport", endsAt: inFuture(7) } })).statusCode).toBe(400);
    expect((await call("POST", { body: { email: "a@example.com", feature: "garage", endsAt: inFuture(-1) } })).statusCode).toBe(400);
    expect((await call("POST", { body: { email: "a@example.com", feature: "garage", endsAt: inFuture(800) } })).statusCode).toBe(400);
    // Deep analyses for a free account would have no limit.
    expect((await call("POST", { body: { email: "a@example.com", feature: "deepAnalysis", endsAt: inFuture(7) } })).statusCode).toBe(400);
  });

  it("offers a feature for 7 days to a free account, shows it on the card, stops it, and logs both", async () => {
    let grants = [] as Array<ReturnType<typeof grantRow>>;
    fake.state.respond = (table, ops) => {
      if (table !== "feature_grants") return { data: [], error: null };
      if (hasOp(ops, "insert")) {
        grants = [grantRow({ ...(ops.find(([op]) => op === "insert")![1][0] as object) })];
        return { data: grants, error: null };
      }
      if (hasOp(ops, "update")) {
        grants = [{ ...grants[0], ...(ops.find(([op]) => op === "update")![1][0] as object) }];
        return { data: grants, error: null };
      }
      return { data: grants, error: null };
    };
    const given = await call("POST", { body: { email: "Free@Example.com", feature: "garage", endsAt: inFuture(7), note: "Essai" } });
    expect(given.statusCode).toBe(201);

    const card = await call("GET", { query: { email: "free@example.com" } });
    expect(card.statusCode).toBe(200);
    const body = card.body as import("@/pages/api/admin/account").AdminAccountCard;
    expect(body.plan).toBe("free");
    expect(body.features.find((line) => line.feature === "garage")).toMatchObject({ kind: "grant", on: true });
    expect(body.ready).toEqual({ own: true, grants: true });
    expect(body.quotas.every((quota) => !quota.own)).toBe(true);

    expect((await call("PATCH", { body: { action: "stop", id: grants[0].id } })).statusCode).toBe(200);
    expect(Date.parse(grants[0].ends_at)).toBeLessThanOrEqual(Date.now());

    const { readAdminLog } = await import("@/lib/server/adminLog");
    const log = await readAdminLog(2);
    expect(log.map((entry) => entry.action)).toEqual(["feature_grant_stop", "feature_grant"]);
    expect(log[1].detail).toContain("free@example.com · garage");
  });

  it("says the migration is missing rather than losing an offer", async () => {
    fake.state.respond = (table) => (table === "feature_grants" ? { data: null, error: missingTable } : { data: [], error: null });
    const refused = await call("POST", { body: { email: "a@example.com", feature: "garage", endsAt: inFuture(7) } });
    expect(refused.statusCode).toBe(409);
    expect(JSON.stringify(refused.body)).toContain("migration_needed");
  });
});

describe("Admin → features route, only new subscriptions", () => {
  async function put(body: unknown) {
    const { default: handler } = await import("@/pages/api/admin/features");
    const req = { method: "PUT", body, headers: { authorization: `Bearer ${process.env.ADMIN_TOKEN}` }, socket: { remoteAddress: "10.1.2.5" } } as unknown as NextApiRequest;
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
    };
    await handler(req, res as unknown as NextApiResponse);
    return res;
  }

  it("refuses before the migration, then keeps the running subscriptions' features and logs it", async () => {
    const { getPlansConfig } = await import("@/lib/server/planConfig");
    const start = await getPlansConfig();
    const next = setPlanFeatures({ features: start.features, featureStatus: start.featureStatus }, "premium", ["garage"], false);

    fake.state.respond = (table, ops) => (hasOp(ops, "select", (args) => String(args[0]).includes("features")) ? { data: null, error: missingColumn } : { data: [], error: null });
    expect((await put({ ...next, apply: "new" })).statusCode).toBe(409);
    expect((await getPlansConfig()).features.premium).toContain("garage");

    const { resetMissing } = await import("@/lib/server/schemaMissing");
    resetMissing();
    const updated: unknown[] = [];
    fake.state.respond = (_table, ops) => {
      if (hasOp(ops, "update")) updated.push(ops.find(([op]) => op === "update")![1][0]);
      if (hasOp(ops, "order")) return { data: [{ id: "s1", email: "a@example.com", plan: "premium", starts_at: "2026-01-01T00:00:00Z", ends_at: null, features: null, quotas: null, created_at: "2026-01-01T00:00:00Z" }], error: null };
      return { data: [], error: null };
    };
    const saved = await put({ ...next, apply: "new" });
    expect(saved.statusCode).toBe(200);
    expect(saved.body).toMatchObject({ kept: 1 });
    expect(updated).toEqual([{ features: { add: ["garage"], remove: [] } }]);
    expect((await getPlansConfig()).features.premium).not.toContain("garage");
    const { readAdminLog } = await import("@/lib/server/adminLog");
    expect((await readAdminLog(1))[0]).toMatchObject({ action: "feature_keep", detail: "1 running subscriptions keep their features (premium)" });
  });
});

