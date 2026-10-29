import type { NextApiRequest, NextApiResponse } from "next";
import { describe, expect, it, vi } from "vitest";
import { activeSubscriberCounts, describeChange, featureChanges, setPlanFeatures, tickAlso, untickAlso } from "@/lib/featureChanges";
import { planPerks, offerLines } from "@/lib/planPerks";
import {
  defaultFeatureSettings,
  defaultPlansConfig,
  effectiveFeatures,
  featureDependents,
  featureFromConfig,
  hasFeature,
  planAllows,
  planFeatureList,
  planFeatures,
  planFor,
  planIds,
  planSuggested,
  deepWithoutLimit,
  withFeatureDefaults,
  type FeatureSettings,
  type PlanFeature,
  type PlanId,
} from "@/lib/plans";
import { hasOwnExpenses } from "@/lib/expenses";
import { paidReminderUsers } from "@/lib/server/reminderPush";

vi.mock("@/lib/server/redis", () => ({ redis: null }));
vi.mock("@/lib/server/supabaseAdmin", () => ({ accountsEnabled: true, supabaseAdmin: () => null, verifyAccount: async () => null }));
vi.mock("@/lib/server/subscriptions", () => ({
  listSubscriptions: async () => [
    { email: "a@example.com", plan: "premium", startsAt: "2026-01-01T00:00:00Z", endsAt: null },
    { email: "b@example.com", plan: "premium", startsAt: "2026-01-01T00:00:00Z", endsAt: null },
    { email: "c@example.com", plan: "lite", startsAt: "2026-01-01T00:00:00Z", endsAt: "2026-02-01T00:00:00Z" },
  ],
}));

/**
 * The ladder as it was before the features could be set (lib/plans.ts,
 * featureFrom), written out by hand: the defaults must give exactly this.
 */
const ladder: Record<PlanId, PlanFeature[]> = {
  free: [],
  lite: ["reminders", "parcelCosts", "pdfExport", "ownKey"],
  premium: ["reminders", "parcelCosts", "pdfExport", "ownKey", "deepAnalysis", "multiPage", "garage"],
  pro: ["reminders", "parcelCosts", "pdfExport", "ownKey", "deepAnalysis", "multiPage", "garage", "reseller"],
  unlimited: ["reminders", "parcelCosts", "pdfExport", "ownKey", "deepAnalysis", "multiPage", "garage", "reseller", "expenses", "loans"],
};
const ladderFrom: Record<PlanFeature, PlanId> = { ownKey: "lite", parcelCosts: "lite", reseller: "pro", deepAnalysis: "premium", multiPage: "premium", pdfExport: "lite", garage: "premium", reminders: "lite", expenses: "unlimited", loans: "unlimited" };

const clone = (settings: FeatureSettings): FeatureSettings => JSON.parse(JSON.stringify(settings)) as FeatureSettings;
const sorted = (features: Iterable<PlanFeature>) => [...features].sort();

describe("features by plan: nothing changes until the owner changes something", () => {
  it.each(planIds)("the defaults give %s exactly the old ladder, feature by feature", (plan) => {
    for (const feature of planFeatures) {
      const expected = ladder[plan].includes(feature);
      expect(effectiveFeatures({ plan, email: "someone@example.com", config: defaultPlansConfig }).has(feature), `${plan} / ${feature}`).toBe(expected);
      expect(effectiveFeatures({ plan, config: defaultFeatureSettings }).has(feature)).toBe(expected);
      expect(hasFeature(plan, feature)).toBe(expected);
      expect(planAllows({ plan, features: planFeatureList(plan, defaultPlansConfig) }, feature)).toBe(expected);
    }
    expect(sorted(planFeatureList(plan, defaultPlansConfig))).toEqual(sorted(ladder[plan]));
    expect(sorted(defaultPlansConfig.features[plan])).toEqual(sorted(ladder[plan]));
  });

  it("gives the same 'from…' labels as before", () => {
    expect(featureFromConfig(defaultPlansConfig)).toEqual(ladderFrom);
    for (const feature of planFeatures) expect(planFor(feature)).toBe(ladderFrom[feature]);
    expect(planFeatures.every((feature) => defaultPlansConfig.featureStatus[feature].mode === "on")).toBe(true);
  });

  it("lists every feature once", () => {
    expect(new Set(planFeatures).size).toBe(planFeatures.length);
    expect(sorted(planFeatures)).toEqual(sorted(Object.keys(ladderFrom) as PlanFeature[]));
  });

  it("keeps the perks and the offers page lines of each plan", () => {
    const t = (key: string, params?: Record<string, string | number>) => (params ? `${key} ${JSON.stringify(params)}` : key);
    const limits = { scans: 60, questionsPerDay: 10, parcels: 15, deepPerMonth: 30 };
    for (const plan of planIds) {
      const settings = planFeatureList(plan, defaultPlansConfig);
      expect(planPerks(plan, limits, t, "fr", (feature) => settings.includes(feature))).toEqual(planPerks(plan, limits, t, "fr"));
    }
    expect(planPerks("lite", limits, t, "fr").slice(3)).toEqual(["plans.features.reminders", "plans.features.parcelCosts", "plans.features.pdfExport", "plans.features.ownKey"]);
    const lines = (id: "lite" | "premium" | "pro", below: "lite" | "premium" | null) =>
      offerLines({ id, features: ladder[id], deepPerMonth: 60 }, below && { id: below, features: ladder[below] }, ["limits"], t, "fr");
    expect(lines("pro", "premium")).toEqual([{ text: "plans.features.allPremium", inherit: true }, { text: "limits" }, { text: 'plans.features.deep {"count":"60"}' }, { text: "plans.features.clients" }, { text: "plans.features.reseller" }]);
    expect(lines("premium", "lite").map((line) => line.text)).toEqual(["plans.features.allLite", "limits", 'plans.features.deep {"count":"60"}', "plans.features.priority", "plans.features.multiPage", "plans.features.garage"]);
    expect(lines("lite", null).map((line) => line.text)).toEqual(["limits", "plans.features.reminders", "plans.features.parcelCosts", "plans.features.pdfExport", "plans.features.ownKey"]);
  });

  it("falls back on the ladder in the app until the server sent its list", () => {
    expect(planAllows(null, "reminders")).toBe(false);
    expect(planAllows({ plan: "premium" }, "garage")).toBe(true);
    expect(planAllows({ plan: "premium", features: [] }, "garage")).toBe(false);
    expect(planSuggested(null, "garage")).toBe("premium");
    expect(planSuggested({ featureFrom: { garage: "pro" } }, "garage")).toBe("pro");
    expect(planSuggested({ featureFrom: { garage: null } }, "garage")).toBeNull();
    // A feature the server doesn't know yet (an app newer than it): the ladder.
    expect(planSuggested({ featureFrom: {} }, "expenses")).toBe("unlimited");
  });
});

describe("features in test and switched off", () => {
  it("in test: only the testers (any plan, any case) and the administrators", () => {
    const config = clone(defaultFeatureSettings);
    config.featureStatus.garage = { mode: "test", testers: ["rado@example.com"] };
    expect(effectiveFeatures({ plan: "free", email: "Rado@Example.com ", config }).has("garage")).toBe(true);
    expect(effectiveFeatures({ plan: "premium", email: "other@example.com", config }).has("garage")).toBe(false);
    expect(effectiveFeatures({ plan: "pro", config }).has("garage")).toBe(false);
    expect(effectiveFeatures({ plan: "unlimited", email: "admin@example.com", config }).has("garage")).toBe(true);
    // Not announced: no "from…" label, not on the offers.
    expect(featureFromConfig(config).garage).toBeNull();
    expect(planFeatureList("premium", config)).not.toContain("garage");
  });

  it("switched off: nobody, administrators and testers included", () => {
    const config = clone(defaultFeatureSettings);
    config.featureStatus.deepAnalysis = { mode: "off", testers: ["rado@example.com"] };
    for (const plan of planIds) expect(effectiveFeatures({ plan, email: "rado@example.com", config }).has("deepAnalysis")).toBe(false);
    expect(featureFromConfig(config).deepAnalysis).toBeNull();
    // The reminders cron goes by it too.
    config.featureStatus.reminders = { mode: "off", testers: [] };
    const users = [{ id: "u1", email: "a@example.com" }];
    const rows = [{ email: "a@example.com", plan: "pro" as const, starts_at: "2026-01-01T00:00:00Z", ends_at: null }];
    expect(paidReminderUsers(users, rows, Date.parse("2026-03-01")).has("u1")).toBe(true);
    expect(paidReminderUsers(users, rows, Date.parse("2026-03-01"), config).has("u1")).toBe(false);
  });

  it("goes by the boxes, ladder or not", () => {
    const config = clone(defaultFeatureSettings);
    config.features.premium = config.features.premium.filter((feature) => feature !== "garage");
    config.features.free = ["pdfExport"];
    expect(effectiveFeatures({ plan: "premium", config }).has("garage")).toBe(false);
    expect(effectiveFeatures({ plan: "pro", config }).has("garage")).toBe(true);
    expect(effectiveFeatures({ plan: "free", config }).has("pdfExport")).toBe(true);
    expect(featureFromConfig(config)).toMatchObject({ garage: "pro", pdfExport: "free" });
    config.features.unlimited = [];
    config.features.pro = config.features.pro.filter((feature) => feature !== "garage");
    expect(featureFromConfig(config).garage).toBeNull();
  });

  it("leaves room for an account's own additions and removals (lot B)", () => {
    expect(effectiveFeatures({ plan: "free", config: defaultFeatureSettings, granted: ["garage"] }).has("garage")).toBe(true);
    expect(effectiveFeatures({ plan: "pro", config: defaultFeatureSettings, removed: ["garage"] }).has("garage")).toBe(false);
  });
});

describe("dependencies", () => {
  it("drops the reseller tools without the parcels' costs", () => {
    const config = setPlanFeatures(clone(defaultFeatureSettings), "pro", ["parcelCosts"], false);
    const pro = effectiveFeatures({ plan: "pro", config });
    expect(pro.has("parcelCosts")).toBe(false);
    expect(pro.has("reseller")).toBe(false);
    expect(featureFromConfig(config).reseller).toBe("unlimited");
    // Costs switched off: the reseller tools go with them, for everyone.
    const off = clone(defaultFeatureSettings);
    off.featureStatus.parcelCosts = { mode: "off", testers: [] };
    expect(effectiveFeatures({ plan: "unlimited", config: off }).has("reseller")).toBe(false);
  });

  it("names what to untick and to tick with a feature", () => {
    expect(featureDependents("parcelCosts")).toEqual(["reseller"]);
    expect(featureDependents("garage")).toEqual([]);
    expect(untickAlso(defaultFeatureSettings, "pro", "parcelCosts")).toEqual(["reseller"]);
    expect(untickAlso(defaultFeatureSettings, "premium", "parcelCosts")).toEqual([]);
    const bare = setPlanFeatures(clone(defaultFeatureSettings), "free", [], true);
    expect(tickAlso(bare, "free", "reseller")).toEqual(["parcelCosts"]);
    expect(tickAlso(defaultFeatureSettings, "lite", "reseller")).toEqual([]);
  });
});

describe("stored settings", () => {
  it("gives a record saved before the features existed the ladder", async () => {
    expect(withFeatureDefaults(null)).toEqual(defaultFeatureSettings);
    expect(withFeatureDefaults({})).toEqual(defaultFeatureSettings);
    const { getPlansConfig, setPlansConfig } = await import("@/lib/server/planConfig");
    const { features: _features, featureStatus: _status, ...old } = defaultPlansConfig;
    await setPlansConfig({ ...old, freeParcels: 5 } as typeof defaultPlansConfig);
    const read = await getPlansConfig();
    expect(read.freeParcels).toBe(5);
    expect(read.features).toEqual(defaultFeatureSettings.features);
    expect(read.featureStatus).toEqual(defaultFeatureSettings.featureStatus);
  });

  it("gives a feature added after the save its default plans, and cleans the rest", () => {
    const stored = clone(defaultFeatureSettings);
    stored.features.premium = ["garage", "garage", "nope" as PlanFeature];
    delete (stored.featureStatus as Partial<FeatureSettings["featureStatus"]>).expenses;
    stored.featureStatus.garage = { mode: "weird" as "on", testers: ["A@b.co", "a@b.co"] };
    const merged = withFeatureDefaults(stored);
    expect(merged.features.premium).toEqual(["garage"]);
    expect(merged.features.unlimited).toContain("expenses");
    expect(merged.features.pro).not.toContain("expenses");
    expect(merged.featureStatus.garage).toEqual({ mode: "on", testers: ["a@b.co"] });
    expect(merged.featureStatus.expenses).toEqual({ mode: "on", testers: [] });
  });

  it("validates what the Admin sends", async () => {
    const { FeatureSettingsSchema } = await import("@/lib/server/planConfig");
    expect(FeatureSettingsSchema.safeParse(defaultFeatureSettings).success).toBe(true);
    const unknown = clone(defaultFeatureSettings);
    unknown.features.lite = ["teleport" as PlanFeature];
    expect(FeatureSettingsSchema.safeParse(unknown).success).toBe(false);
    const badEmail = clone(defaultFeatureSettings);
    badEmail.featureStatus.garage = { mode: "test", testers: ["not an e-mail"] };
    expect(FeatureSettingsSchema.safeParse(badEmail).success).toBe(false);
    const missing = clone(defaultFeatureSettings) as Partial<FeatureSettings>;
    delete missing.featureStatus;
    expect(FeatureSettingsSchema.safeParse(missing).success).toBe(false);
    const upper = clone(defaultFeatureSettings);
    upper.featureStatus.garage = { mode: "test", testers: [" Rado@Example.com "] };
    expect(FeatureSettingsSchema.parse(upper).featureStatus.garage.testers).toEqual(["rado@example.com"]);
  });
});

describe("what a save changes", () => {
  it("lists the changes per plan and per feature, for the summary and the log", () => {
    const after = setPlanFeatures(clone(defaultFeatureSettings), "premium", ["garage"], false);
    after.featureStatus.multiPage = { mode: "test", testers: ["a@b.co"] };
    const changes = featureChanges(defaultFeatureSettings, after);
    expect(changes).toEqual([
      { kind: "plan", plan: "premium", added: [], removed: ["garage"] },
      { kind: "status", feature: "multiPage", from: "on", to: "test", testers: 1 },
    ]);
    expect(changes.map(describeChange)).toEqual(["premium: -garage", "multiPage: on -> test (1 testers)"]);
    expect(featureChanges(defaultFeatureSettings, clone(defaultFeatureSettings))).toEqual([]);
  });

  it("counts the active subscribers of each plan", () => {
    const rows = [
      { email: "a@example.com", plan: "lite" as const, startsAt: "2026-01-01T00:00:00Z", endsAt: null },
      { email: "A@example.com", plan: "pro" as const, startsAt: "2026-01-01T00:00:00Z", endsAt: null },
      { email: "b@example.com", plan: "premium" as const, startsAt: "2026-01-01T00:00:00Z", endsAt: "2026-02-01T00:00:00Z" },
      { email: "c@example.com", plan: "premium" as const, startsAt: "2026-01-01T00:00:00Z", endsAt: null },
    ];
    expect(activeSubscriberCounts(rows, Date.parse("2026-03-01"))).toEqual({ lite: 0, premium: 1, pro: 1, unlimited: 0 });
  });
});

describe("Admin → features route", () => {
  process.env.ADMIN_TOKEN = "admin-token-for-tests-0123456789";

  async function call(method: string, body?: unknown, token = process.env.ADMIN_TOKEN, route: "features" | "plans" = "features") {
    const { default: handler } = route === "features" ? await import("@/pages/api/admin/features") : await import("@/pages/api/admin/plans");
    const req = { method, body, headers: token ? { authorization: `Bearer ${token}` } : {}, socket: { remoteAddress: "10.1.2.3" } } as unknown as NextApiRequest;
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

  it("refuses without the admin token, validates, saves and logs each change", async () => {
    expect((await call("GET", undefined, "wrong")).statusCode).toBe(401);
    const bad = clone(defaultFeatureSettings);
    bad.features.lite = ["teleport" as PlanFeature];
    expect((await call("PUT", bad)).statusCode).toBe(400);

    const next = setPlanFeatures(clone(defaultFeatureSettings), "premium", ["garage"], false);
    next.featureStatus.deepAnalysis = { mode: "off", testers: [] };
    const saved = await call("PUT", next);
    expect(saved.statusCode).toBe(200);
    expect(saved.body).toMatchObject({ subscribers: { premium: 2, lite: 0 }, deepPerMonth: { lite: 0, premium: 30, pro: 60 } });

    const { getPlansConfig } = await import("@/lib/server/planConfig");
    const config = await getPlansConfig();
    expect(config.features.premium).not.toContain("garage");
    expect(config.featureStatus.deepAnalysis.mode).toBe("off");
    // Prices and limits are untouched.
    expect(config.offers).toEqual(defaultPlansConfig.offers);

    const { readAdminLog } = await import("@/lib/server/adminLog");
    const log = await readAdminLog(5);
    expect(log.slice(0, 2).map((entry) => [entry.action, entry.detail])).toEqual([
      ["feature_status", "deepAnalysis: on -> off"],
      ["feature_plans", "premium: -garage"],
    ]);
  });

  it("refuses deep analyses on a plan whose monthly count is 0 (no limit), Admin aside", async () => {
    const { getPlansConfig } = await import("@/lib/server/planConfig");
    const before = await getPlansConfig();
    const onLite = setPlanFeatures({ features: before.features, featureStatus: before.featureStatus }, "lite", ["deepAnalysis"], true);
    const refused = await call("PUT", onLite);
    expect(refused.statusCode).toBe(400);
    expect(JSON.stringify(refused.body)).toContain("lite");
    expect((await getPlansConfig()).features.lite).not.toContain("deepAnalysis");

    // Once Lite has a count, it may have them; Premium can't go back to 0 while it has them.
    const { features: _f, featureStatus: _s, ...prices } = before;
    const withCount = { ...prices, offers: { ...prices.offers, lite: { ...prices.offers.lite, deepPerMonth: 5 } } };
    expect((await call("PUT", withCount, undefined, "plans")).statusCode).toBe(200);
    expect((await call("PUT", onLite)).statusCode).toBe(200);
    const premiumZero = { ...prices, offers: { ...prices.offers, lite: { ...prices.offers.lite, deepPerMonth: 5 }, premium: { ...prices.offers.premium, deepPerMonth: 0 } } };
    expect((await call("PUT", premiumZero, undefined, "plans")).statusCode).toBe(400);
    expect((await getPlansConfig()).offers.premium.deepPerMonth).toBe(30);
  });

  it("lets an emergency cut and a price save through when a plan was already without a limit", async () => {
    const { getPlansConfig, setPlansConfig } = await import("@/lib/server/planConfig");
    const current = await getPlansConfig();
    // Saved before the rule: Lite has deep analyses and 0 a month.
    await setPlansConfig({ ...current, features: { ...current.features, lite: [...current.features.lite, "deepAnalysis"] }, offers: { ...current.offers, lite: { ...current.offers.lite, deepPerMonth: 0 } } });
    const before = await getPlansConfig();
    const cut = { features: before.features, featureStatus: { ...before.featureStatus, garage: { mode: "off" as const, testers: [] } } };
    expect((await call("PUT", cut)).statusCode).toBe(200);
    const { features: _f, featureStatus: _s, ...prices } = before;
    expect((await call("PUT", { ...prices, offers: { ...prices.offers, pro: { ...prices.offers.pro, priceMga: prices.offers.pro.priceMga + 1000 } } }, undefined, "plans")).statusCode).toBe(200);
  });
});

describe("deep analyses need a monthly count", () => {
  it("names the plans ticked with no count; Admin may stay without a limit, free never has one", () => {
    expect(deepWithoutLimit(defaultPlansConfig)).toEqual([]);
    const config = { ...defaultPlansConfig, ...setPlanFeatures(clone(defaultFeatureSettings), "lite", ["deepAnalysis"], true) };
    expect(deepWithoutLimit(config)).toEqual(["lite"]);
    expect(deepWithoutLimit({ ...config, offers: { ...config.offers, lite: { ...config.offers.lite, deepPerMonth: 10 } } })).toEqual([]);
    const free = { ...defaultPlansConfig, ...setPlanFeatures(clone(defaultFeatureSettings), "free", ["deepAnalysis"], true) };
    expect(deepWithoutLimit(free)).toEqual(["free"]);
    const zero = { ...defaultPlansConfig, offers: { ...defaultPlansConfig.offers, premium: { ...defaultPlansConfig.offers.premium, deepPerMonth: 0 } } };
    expect(deepWithoutLimit(zero)).toEqual(["premium"]);
  });
});

describe("kept expenses", () => {
  it("counts live expenses and incomes, not the settings nor what was deleted", () => {
    const base = { id: "x", updatedAt: 1 };
    expect(hasOwnExpenses([])).toBe(false);
    expect(hasOwnExpenses([{ ...base, kind: "budget" } as never])).toBe(false);
    expect(hasOwnExpenses([{ ...base, kind: "expense", deletedAt: 2 } as never])).toBe(false);
    expect(hasOwnExpenses([{ ...base, kind: "expense" } as never])).toBe(true);
    expect(hasOwnExpenses([{ ...base, kind: "income" } as never])).toBe(true);
  });
});
