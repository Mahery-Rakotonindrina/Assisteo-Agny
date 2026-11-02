import { readFileSync } from "node:fs";
import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createdPlanInfo, planIdProblem, planName, planRankIn, planSlug } from "@/lib/customPlans";
import { trialEligible } from "@/lib/offers";
import { offerLines } from "@/lib/planPerks";
import {
  activePlan,
  activeSubscription,
  createdQuotas,
  customPlanColors,
  customPlanInUse,
  defaultPlansConfig,
  effectiveFeatures,
  featureFromConfig,
  isCustomPlanId,
  planFeatureList,
  rankOf,
  withQuotas,
  type CustomPlan,
  type PlanResponse,
  type PlansConfig,
  type Subscription,
} from "@/lib/plans";

// The server's surroundings: no Redis (the settings stay in memory), an
// account and its subscriptions held here, and an Admin always signed in.
const state = vi.hoisted(() => ({
  account: null as { id: string; email: string } | null,
  rows: [] as Array<Pick<Subscription, "id" | "email" | "plan" | "startsAt" | "endsAt" | "amountMga" | "paymentMethod" | "createdAt"> & { features?: null; quotas?: null }>,
  logged: [] as string[],
}));
vi.mock("@/lib/server/redis", () => ({ redis: null }));
vi.mock("@/lib/ai/provider", () => ({ activeProvider: "gemini" }));
vi.mock("@/lib/server/supabaseAdmin", () => ({
  accountsEnabled: true,
  verifyAccount: async () => state.account,
  supabaseAdmin: () => {
    throw new Error("No database in the tests.");
  },
}));
vi.mock("@/lib/server/featureGrants", () => ({ currentGrantsForEmail: async () => [] }));
vi.mock("@/lib/server/adminAuth", () => ({ guardAdmin: async () => ({ id: "owner", owner: true }) }));
vi.mock("@/lib/server/adminLog", () => ({ logAdminAction: async (_actor: string, action: string) => void state.logged.push(action) }));
vi.mock("@/lib/server/subscriptions", async () => {
  const plans = await import("@/lib/plans");
  return {
    listSubscriptions: async () => state.rows,
    subscriptionsForEmail: async (email: string) => state.rows.filter((row) => row.email === email),
    addSubscriptions: async () => [],
    accessForEmail: async (email: string, now: number, created: CustomPlan[]) => {
      const own = state.rows.filter((row) => row.email === email).map((row) => ({ ...row, features: null, quotas: null }));
      const running = plans.activeSubscription(own, now, created);
      return { current: plans.activePlan(own, now, created), subscription: running && { id: running.id, features: null, quotas: null } };
    },
  };
});

const { resolvePlan, limitsFor } = await import("@/lib/server/plan");
const { getPlansConfig, setPlansConfig, setCustomPlans, CustomPlanSchema } = await import("@/lib/server/planConfig");
const { default: planRoute } = await import("@/pages/api/plan");
const { default: customPlansRoute } = await import("@/pages/api/admin/custom-plans");

const NOW = Date.now();
const day = (offset: number) => new Date(NOW + offset * 24 * 3600 * 1000).toISOString();

/** "Famille": between Lite and Premium, with Mon garage and Premium's limits halved. */
const famille: CustomPlan = {
  id: "famille",
  name: { fr: "Famille", en: "Family" },
  color: "teal",
  after: "lite",
  features: ["reminders", "parcelCosts", "pdfExport", "garage"],
  onSale: true,
  createdAt: NOW,
  priceMga: 8000,
  yearPriceMga: 80000,
  scans: 150,
  questionsPerDay: 20,
  parcels: 30,
  deepPerMonth: 0,
};
const config: PlansConfig = { ...defaultPlansConfig, customPlans: [famille] };

const row = (plan: string, start: number, end: number | null, id = `${plan}-${start}`) => ({
  id,
  email: "rado@example.com",
  plan,
  startsAt: day(start),
  endsAt: end === null ? null : day(end),
  amountMga: 8000,
  paymentMethod: "mvola",
  createdAt: day(start),
});

function reply() {
  const res = { statusCode: 0, body: undefined as unknown, headers: {} as Record<string, string> };
  const api = {
    status(code: number) {
      res.statusCode = code;
      return api;
    },
    json(body: unknown) {
      res.body = body;
      return api;
    },
    setHeader(name: string, value: string) {
      res.headers[name] = value;
      return api;
    },
    end() {
      return api;
    },
  };
  return { res, api: api as unknown as NextApiResponse };
}
const request = (fields: Partial<NextApiRequest>) => ({ method: "GET", headers: {}, query: {}, body: undefined, ...fields }) as NextApiRequest;

beforeEach(async () => {
  state.account = null;
  state.rows = [];
  state.logged = [];
  await setPlansConfig({ ...config, customPlans: [famille] });
});

describe("the rank of a created plan", () => {
  it("sits between its slot and the next built-in plan, in the order of the list", () => {
    const etudiant = { ...famille, id: "etudiant", after: "lite" as const };
    expect(rankOf("famille", [famille])).toBe(1.5);
    expect(rankOf("famille", [famille, etudiant])).toBeCloseTo(1 + 1 / 3);
    expect(rankOf("etudiant", [famille, etudiant])).toBeCloseTo(1 + 2 / 3);
    expect(rankOf("premium", [famille])).toBe(2);
    // Deleted since, or never known: below everything.
    expect(rankOf("ancienne", [famille])).toBe(-1);
  });

  it("gives the 'from…' label to the created plan once it has the feature, for an app that knows it", () => {
    expect(featureFromConfig(config, true).garage).toBe("famille");
    expect(featureFromConfig(config, true).multiPage).toBe("premium");
    // An older app: the built-in plans only.
    expect(featureFromConfig(config).garage).toBe("premium");
    // Off sale: no longer offered, so no longer the label.
    expect(featureFromConfig({ ...config, customPlans: [{ ...famille, onSale: false }] }, true).garage).toBe("premium");
  });

  it("announces its own features, the states and needs applied", () => {
    expect(planFeatureList("famille", config)).toEqual(["reminders", "parcelCosts", "pdfExport", "garage"]);
    const off = { ...config, featureStatus: { ...config.featureStatus, garage: { mode: "off" as const, testers: [] } } };
    expect(planFeatureList("famille", off)).not.toContain("garage");
    // The reseller tools need the parcels' costs.
    const reseller = { ...config, customPlans: [{ ...famille, features: ["reseller" as const] }] };
    expect(planFeatureList("famille", reseller)).toEqual([]);
  });
});

describe("the best plan running", () => {
  it("keeps the built-in plan just below for an older app, and the created plan itself", () => {
    expect(activePlan([row("lite", -5, 25), row("famille", -2, 28)], NOW, [famille])).toEqual({ plan: "lite", endsAt: Date.parse(day(28)), custom: "famille" });
    expect(activePlan([row("famille", -2, 28), row("premium", -1, 10)], NOW, [famille])).toEqual({ plan: "premium", endsAt: Date.parse(day(10)) });
  });

  it("follows the renewals of the created plan, and the plans above it", () => {
    const rows = [row("famille", -20, 10), row("famille", 10, 40), row("premium", 40, 70), row("lite", 70, 100)];
    expect(activePlan(rows, NOW, [famille])).toMatchObject({ custom: "famille", endsAt: Date.parse(day(70)) });
    expect(activeSubscription(rows, NOW, [famille])?.id).toBe("famille--20");
  });

  it("leaves out a plan it doesn't know (none passed, or deleted)", () => {
    expect(activePlan([row("famille", -2, 28)], NOW)).toEqual({ plan: "free", endsAt: null });
    expect(activePlan([row("famille", -2, 28), row("lite", -2, 5)], NOW)).toEqual({ plan: "lite", endsAt: Date.parse(day(5)) });
  });

  it("counts a created plan above Premium against the Premium trial", () => {
    const above = { ...famille, id: "pro-plus", after: "premium" as const };
    expect(trialEligible([{ plan: "famille", paymentMethod: "mvola" }], [famille])).toBe(true);
    expect(trialEligible([{ plan: "pro-plus", paymentMethod: "mvola" }], [above])).toBe(false);
  });
});

describe("what the server goes by", () => {
  it("gives a created plan's subscriber its own features and limits, not the plan below's", async () => {
    state.account = { id: "user-1", email: "rado@example.com" };
    state.rows = [row("famille", -2, 28)];
    const resolved = await resolvePlan(request({}), config);
    expect(resolved.current).toMatchObject({ plan: "lite", custom: "famille" });
    expect(resolved.customPlan?.id).toBe("famille");
    expect(resolved.features.has("garage")).toBe(true);
    expect(resolved.features.has("ownKey")).toBe(false);
    expect(await limitsFor(resolved.current.plan, config, resolved.quotas, resolved.features)).toEqual({ scans: 150, questionsPerDay: 20, parcels: 30, deepPerMonth: 0 });
  });

  it("puts a subscription's own limits over the created plan's", () => {
    const quotas = createdQuotas(config, "famille", { scans: 500 });
    expect(withQuotas("lite", defaultPlansConfig.offers.lite, quotas)).toMatchObject({ scans: 500, questionsPerDay: 20, parcels: 30, deepPerMonth: 0 });
    expect(createdQuotas(config, null, { scans: 500 })).toEqual({ scans: 500 });
    expect(effectiveFeatures({ plan: "lite", custom: "famille", config }).has("garage")).toBe(true);
    expect(effectiveFeatures({ plan: "lite", config }).has("garage")).toBe(false);
  });
});

describe("GET /api/plan", () => {
  const get = async (headers: Record<string, string> = {}) => {
    const { res, api } = reply();
    await planRoute(request({ headers }), api);
    return res.body as PlanResponse;
  };

  it("tells an older app only of the built-in plans, its plan the one just below", async () => {
    state.account = { id: "user-1", email: "rado@example.com" };
    state.rows = [row("famille", -2, 28)];
    const body = await get();
    expect(body.plan).toBe("lite");
    expect(body.offers.map((offer) => offer.id)).toEqual(["lite", "premium", "pro"]);
    expect(body.featureFrom?.garage).toBe("premium");
    // What it may use and its limits are the created plan's.
    expect(body.features).toContain("garage");
    expect(body.limits.scans).toBe(150);
    expect(body.payments?.[0]?.plan).toBe("lite");
    // Only added: an older app ignores it.
    expect(body.customPlan).toMatchObject({ id: "famille", color: "teal", rank: 1.5 });
  });

  it("lists the created plans for an app that asks for them", async () => {
    const body = await get({ "x-plans": "all" });
    expect(body.plan).toBe("free");
    const created = body.offers.find((offer) => offer.id === "famille");
    expect(created).toMatchObject({ priceMga: 8000, name: { fr: "Famille", en: "Family" }, color: "teal", rank: 1.5 });
    expect(created?.features).toContain("garage");
    expect(body.featureFrom?.garage).toBe("famille");
    expect(createdPlanInfo("famille", body)?.color).toBe("teal");
    expect(planRankIn("famille", body)).toBe(1.5);
    expect(planName("famille", (key) => key, "en", body)).toBe("Family");
    expect(planName("lite", (key) => key, "en", body)).toBe("plans.names.lite");
  });

  it("no longer offers a plan off sale, but still shows it to the one who has it", async () => {
    await setCustomPlans([{ ...famille, onSale: false }]);
    expect((await get({ "x-plans": "all" })).offers.map((offer) => offer.id)).toEqual(["lite", "premium", "pro"]);
    state.account = { id: "user-1", email: "rado@example.com" };
    state.rows = [row("famille", -2, 28)];
    expect((await get({ "x-plans": "all" })).offers.map((offer) => offer.id)).toContain("famille");
  });
});

describe("a created plan's id", () => {
  it("is drawn from its name", () => {
    expect(planSlug("Famille")).toBe("famille");
    expect(planSlug("Étudiant 2026")).toBe("etudiant-2026");
    expect(planSlug("  Pro+ Max !")).toBe("pro-max");
    expect(planSlug("2026")).toBe("");
    expect(planSlug("A")).toBe("");
  });

  it("is short, lowercase, not a built-in plan nor taken", () => {
    expect(planIdProblem("famille", [])).toBeNull();
    expect(planIdProblem("Famille", [])).toBe("format");
    expect(planIdProblem("f", [])).toBe("format");
    expect(planIdProblem("famille-nombreuse-2026-xyz", [])).toBe("format");
    expect(planIdProblem("premium", [])).toBe("builtIn");
    expect(planIdProblem("famille", ["famille"])).toBe("taken");
    expect(isCustomPlanId("unlimited")).toBe(false);
    expect(CustomPlanSchema.safeParse({ ...famille, id: "free" }).success).toBe(false);
    expect(CustomPlanSchema.safeParse({ ...famille, id: "étudiant" }).success).toBe(false);
    expect(CustomPlanSchema.safeParse(famille).success).toBe(true);
  });

  it("matches the check of migration 0015", () => {
    const sql = readFileSync("supabase/migrations/0015_offres_creees.sql", "utf8");
    const pattern = /plan ~ '([^']+)'/.exec(sql)?.[1];
    expect(pattern).toBe(/^[a-z][a-z0-9-]{1,23}$/.source);
    expect(sql).toContain("insert into public._migrations (name) values ('0015_offres_creees.sql')");
  });
});

describe("Admin → Offers: the created plans", () => {
  const call = async (method: string, fields: Partial<NextApiRequest> = {}) => {
    const { res, api } = reply();
    await customPlansRoute(request({ method, ...fields }), api);
    return res;
  };
  const { onSale: _onSale, createdAt: _createdAt, ...input } = famille;

  it("creates one, on sale, noted in the admin log", async () => {
    await setCustomPlans([]);
    const res = await call("POST", { body: { ...input, id: "etudiant", name: { fr: "Étudiant", en: "Student" } } });
    expect(res.statusCode).toBe(201);
    const saved = (await getPlansConfig()).customPlans;
    expect(saved).toMatchObject([{ id: "etudiant", onSale: true }]);
    expect(state.logged).toEqual(["plan_create"]);
    // The same id again, a built-in one, deep analyses without a count: refused.
    expect((await call("POST", { body: { ...input, id: "etudiant" } })).statusCode).toBe(400);
    expect((await call("POST", { body: { ...input, id: "premium" } })).statusCode).toBe(400);
    expect((await call("POST", { body: { ...input, id: "deep", features: ["deepAnalysis"], deepPerMonth: 0 } })).statusCode).toBe(400);
  });

  it("keeps the id when changed, and moves a plan to the end of its new slot", async () => {
    const other = { ...famille, id: "solo", after: "premium" as const };
    await setCustomPlans([famille, other]);
    const res = await call("PUT", { body: { ...input, onSale: false, after: "premium", priceMga: 9000 } });
    expect(res.statusCode).toBe(200);
    const saved = (await getPlansConfig()).customPlans;
    expect(saved.map((plan) => plan.id)).toEqual(["solo", "famille"]);
    expect(saved[1]).toMatchObject({ onSale: false, priceMga: 9000, createdAt: famille.createdAt });
    expect((await call("PUT", { body: { ...input, id: "inconnue", onSale: true } })).statusCode).toBe(404);
  });

  it("refuses to delete a plan someone has running or starting later: it can only go off sale", async () => {
    state.rows = [row("famille", -2, 28)];
    expect(customPlanInUse("famille", state.rows, NOW)).toBe(true);
    expect((await call("DELETE", { query: { id: "famille" } })).statusCode).toBe(409);
    expect((await getPlansConfig()).customPlans).toHaveLength(1);

    state.rows = [{ ...row("famille", 1000, 1030) }];
    expect(customPlanInUse("famille", state.rows, NOW)).toBe(true);
    // Ended: deleted, its old rows staying as the record of what was paid.
    state.rows = [row("famille", -60, -30)];
    expect(customPlanInUse("famille", state.rows, NOW)).toBe(false);
    expect((await call("DELETE", { query: { id: "famille" } })).statusCode).toBe(200);
    expect((await getPlansConfig()).customPlans).toEqual([]);
    expect(state.logged).toEqual(["plan_delete"]);
  });

  it("keeps the stored plans that still read right, and drops a feature removed since", async () => {
    await setPlansConfig({ ...config, customPlans: [{ ...famille, features: ["garage", "gone" as never] }, { id: "Broken" } as never] });
    expect((await getPlansConfig()).customPlans).toEqual([{ ...famille, features: ["garage"] }]);
  });
});

describe("the offers page", () => {
  it("shows what a created plan adds over the built-in plan below it, by its name", () => {
    const t = (key: string, params?: Record<string, string | number>) => (params?.plan ? `${key}:${params.plan}` : key);
    const lines = offerLines({ id: "famille", features: ["reminders", "garage"], deepPerMonth: 0 }, { id: "lite", name: "Lite", features: ["reminders"] }, [], t, "fr");
    expect(lines.map((line) => line.text)).toEqual(["plans.features.allLite", "plans.features.garage"]);
    const above = offerLines({ id: "pro-plus", features: ["garage"], deepPerMonth: 0 }, { id: "pro", name: "Pro", features: ["garage"] }, [], t, "fr");
    expect(above[0].text).toBe("plans.features.allPlan:Pro");
  });
});

describe("the colours of the created plans", () => {
  // WCAG contrast of two colours.
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255).map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light + 0.05) / (dark + 0.05);
  };
  const scss = readFileSync("styles/planColors.scss", "utf8");
  const tones = (theme: "dark" | "light") => {
    const block = new RegExp(`\\$${theme}: \\(([\\s\\S]*?)\\n\\);`).exec(scss)?.[1] ?? "";
    return Object.fromEntries([...block.matchAll(/"(\w+)": \((#[0-9a-f]{6}), (#[0-9a-f]{6})\)/g)].map((match) => [match[1], [match[2], match[3]]]));
  };
  // The page's background, also the badge's ink (styles/globals.scss).
  const backgrounds = { dark: "#0b0c10", light: "#f4f5f0" };

  it("has every colour of the palette, on both themes", () => {
    for (const theme of ["dark", "light"] as const) expect(Object.keys(tones(theme)).sort()).toEqual([...customPlanColors].sort());
  });

  it("stays readable (AA) under the badge's ink and on the page, in light and dark", () => {
    for (const theme of ["dark", "light"] as const) {
      for (const [color, pair] of Object.entries(tones(theme))) {
        for (const tone of pair as string[]) expect(contrast(tone, backgrounds[theme]), `${theme} ${color} ${tone}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
