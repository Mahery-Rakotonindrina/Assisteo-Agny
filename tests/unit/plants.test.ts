import type { NextApiRequest, NextApiResponse } from "next";
import { describe, expect, it, vi } from "vitest";
import { mockAnalysis } from "@/lib/ai/mock";
import { mockPlantDiagnosis } from "@/lib/ai/plantDiagnosisDemo";
import { buildPlantDiagnosisPrompt } from "@/lib/ai/prompt";
import { AnalysisSchema, normalizeStoredAnalysis, PlantDiagnosisRequestSchema, PlantDiagnosisSchema, type PlantDiagnosis } from "@/lib/ai/schema";
import { hasFeature, planFor, withFeatureDefaults } from "@/lib/plans";
import {
  cleanWaterDays,
  daysUntilWater,
  DEFAULT_WATER_DAYS,
  isRainySeason,
  morningKey,
  needsWater,
  plantFieldsFrom,
  sortPlants,
  suggestedWaterDays,
  wateredToday,
  wateringMornings,
  WATER_HOUR,
  type Plant,
} from "@/lib/plants";
import { tapTarget } from "@/services/notificationTap";
import { PLANT_ENTRY_ID, reconcilePlantReminderState, type PlantReminderDeps, type ScheduledMornings } from "@/services/plantReminders";

// The route's dependencies: an AI engine that diagnoses, and the plan of the account.
const state = vi.hoisted(() => ({ provider: "gemini", plan: "lite" as string, account: true as boolean, accountId: "gardener-1", fail: false, calls: 0 }));
vi.mock("@/lib/server/redis", () => ({ redis: null }));
vi.mock("@/lib/ai/provider", () => ({
  get activeProvider() {
    return state.provider;
  },
  diagnosePlant: async () => {
    state.calls += 1;
    if (state.fail) throw new Error("The AI is down.");
    return { diagnosis: mockPlantDiagnosis("fr"), model: "gemini-flash-latest", usage: { inputTokens: 1100, outputTokens: 250 } };
  },
}));
vi.mock("@/lib/server/plan", () => ({
  limitsFor: async () => ({ scans: 0, questionsPerDay: 0, parcels: 0, deepPerMonth: 0 }),
  resolvePlan: async () => {
    const { defaultPlansConfig, effectiveFeatures } = await import("@/lib/plans");
    type PlanId = Parameters<typeof effectiveFeatures>[0]["plan"];
    return {
      account: state.account ? { id: state.accountId, email: "a@example.com" } : null,
      current: { plan: state.plan, endsAt: null },
      features: effectiveFeatures({ plan: state.plan as PlanId, email: "a@example.com", config: defaultPlansConfig }),
      quotas: null,
    };
  },
}));

const { default: diagnoseRoute } = await import("@/pages/api/plants/diagnose");
const { getPlanUsage } = await import("@/lib/server/trialStore");

const DAY = 86_400_000;
// Wednesday 2026-01-14, 10:00 local: the rainy season.
const now = new Date(2026, 0, 14, 10).getTime();
const plant = (fields: Partial<Plant> = {}): Plant => ({ id: "p", name: "Monstera", place: "indoor", waterEveryDays: 7, scanIds: [], checks: [], createdAt: now - 30 * DAY, updatedAt: now, ...fields });

describe("the plan feature", () => {
  it("is from Lite, and an Admin record saved before it gets the default", () => {
    expect(planFor("plants")).toBe("lite");
    expect(hasFeature("free", "plants")).toBe(false);
    expect(hasFeature("lite", "plants")).toBe(true);
    const old = withFeatureDefaults({ features: { free: [], lite: ["reminders"], premium: ["reminders"], pro: ["reminders"], unlimited: ["reminders"] }, featureStatus: { reminders: { mode: "on", testers: [] } } as never });
    expect(old.features.lite).toContain("plants");
    expect(old.features.free).not.toContain("plants");
    expect(old.featureStatus.plants.mode).toBe("on");
  });
});

describe("the analysis's plant block", () => {
  it("is null on a scan saved before it existed", () => {
    const { plant: _gone, ...old } = mockAnalysis("object", "fr");
    void _gone;
    expect(AnalysisSchema.parse(normalizeStoredAnalysis(old)).plant).toBeNull();
  });

  it("is filled in on the demo plant, and gives the plant's fields for the season", () => {
    const analysis = mockAnalysis("object", "fr");
    expect(analysis.category).toBe("plant");
    expect(plantFieldsFrom(analysis, now)).toEqual({ name: "Monstera deliciosa", species: "Monstera deliciosa", place: "indoor", waterEveryDays: 7 });
    expect(plantFieldsFrom(analysis, new Date(2026, 6, 1).getTime()).waterEveryDays).toBe(10);
    expect(plantFieldsFrom({ title: "Basilic", plant: null }, now)).toMatchObject({ place: "indoor", waterEveryDays: DEFAULT_WATER_DAYS });
  });

  it("knows the seasons, and keeps the days sensible", () => {
    expect(isRainySeason(new Date(2026, 10, 1).getTime())).toBe(true);
    expect(isRainySeason(new Date(2026, 3, 30).getTime())).toBe(true);
    expect(isRainySeason(new Date(2026, 4, 1).getTime())).toBe(false);
    expect(cleanWaterDays(0)).toBe(DEFAULT_WATER_DAYS);
    expect(cleanWaterDays(2.4)).toBe(2);
    expect(cleanWaterDays(400)).toBe(60);
    expect(suggestedWaterDays(undefined, now)).toBe(DEFAULT_WATER_DAYS);
  });
});

describe("watering", () => {
  it("counts the days from the last watering, today first when never watered", () => {
    expect(daysUntilWater(plant(), now)).toBe(-30);
    expect(daysUntilWater(plant({ lastWateredAt: now - 3 * DAY }), now)).toBe(4);
    expect(daysUntilWater(plant({ lastWateredAt: now - 7 * DAY }), now)).toBe(0);
    expect(needsWater(plant({ lastWateredAt: now - 7 * DAY }), now)).toBe(true);
    expect(needsWater(plant({ lastWateredAt: now }), now)).toBe(false);
    expect(wateredToday(plant({ lastWateredAt: now - 60_000 }), now)).toBe(true);
  });

  it("lists the plants to water first, the latest first", () => {
    const sorted = sortPlants(
      [plant({ id: "a", name: "Aloe", lastWateredAt: now - 1 * DAY }), plant({ id: "b", name: "Basilic", lastWateredAt: now - 9 * DAY }), plant({ id: "c", name: "Cactus", lastWateredAt: now - 7 * DAY })],
      now,
    );
    expect(sorted.map((item) => item.name)).toEqual(["Basilic", "Cactus", "Aloe"]);
  });

  it("rings on the mornings with a plant to water, with their names", () => {
    const mornings = wateringMornings([plant({ name: "Aloe", lastWateredAt: now - 5 * DAY }), plant({ name: "Basilic", waterEveryDays: 3, lastWateredAt: now })], now);
    // Today's morning has passed (10:00): from tomorrow, 7 mornings.
    expect(new Date(mornings[0].at).getHours()).toBe(WATER_HOUR);
    expect(mornings.map(({ at, names }) => [morningKey(at), names])).toEqual([
      ["2026-01-16", ["Aloe"]],
      ["2026-01-17", ["Aloe", "Basilic"]],
      ["2026-01-18", ["Aloe", "Basilic"]],
      ["2026-01-19", ["Aloe", "Basilic"]],
      ["2026-01-20", ["Aloe", "Basilic"]],
      ["2026-01-21", ["Aloe", "Basilic"]],
    ]);
    expect(wateringMornings([plant()], now, false)).toEqual([]);
  });
});

describe("the morning reminder", () => {
  function deps(scheduled: ScheduledMornings = {}) {
    const calls = { notified: [] as Array<{ at: Date; body: string; entryId: string }>, cancelled: [] as number[] };
    let saved = scheduled;
    let next = 100;
    const value: PlantReminderDeps = {
      permission: async () => "granted",
      notify: async ({ at, body, entryId }) => {
        calls.notified.push({ at, body, entryId });
        next += 1;
        return next;
      },
      cancel: async (id) => {
        calls.cancelled.push(id);
      },
      pending: async () => null,
      load: () => saved,
      save: (state) => {
        saved = state;
      },
    };
    return { value, calls, saved: () => saved };
  }
  const texts = (names: string[]) => ({ title: "Mes plantes", body: names.join(", ") });

  it("schedules the mornings once, then only what changed, and cancels all without the plan", async () => {
    const plants = [plant({ name: "Aloe", lastWateredAt: now - 6 * DAY })];
    const device = deps();
    await reconcilePlantReminderState(plants, texts, device.value, { now });
    expect(device.calls.notified).toHaveLength(7);
    expect(device.calls.notified[0].entryId).toBe(PLANT_ENTRY_ID);
    await reconcilePlantReminderState(plants, texts, device.value, { now });
    expect(device.calls.notified).toHaveLength(7);
    // Watered: nothing until 7 days later, the mornings before are cancelled, that one kept.
    await reconcilePlantReminderState([{ ...plants[0], lastWateredAt: now }], texts, device.value, { now });
    expect(device.calls.cancelled).toHaveLength(6);
    expect(device.calls.notified).toHaveLength(7);
    expect(Object.keys(device.saved())).toEqual(["2026-01-21"]);
    await reconcilePlantReminderState(plants, texts, device.value, { now, enabled: false });
    expect(Object.keys(device.saved())).toEqual([]);
  });

  it("opens My plants when tapped", () => {
    expect(tapTarget(PLANT_ENTRY_ID)).toEqual({ pathname: "/plants" });
  });
});

describe("the diagnosis", () => {
  it("has a demo answer and a careful prompt", () => {
    for (const locale of ["fr", "en"] as const) expect(PlantDiagnosisSchema.safeParse(mockPlantDiagnosis(locale)).success).toBe(true);
    const prompt = buildPlantDiagnosisPrompt({ locale: "en", plant: "Basilic", place: "outdoor" });
    expect(prompt).toContain('"Basilic"');
    expect(prompt).toContain("outdoors");
    expect(prompt).toContain("English");
  });

  const body = { image: "AAAA", mediaType: "image/jpeg", locale: "fr", plant: "Monstera", place: "indoor" };

  async function call(payload: unknown, method = "POST") {
    const req = { method, headers: {}, body: payload, socket: { remoteAddress: `10.4.0.${Math.floor(Math.random() * 250)}` } } as unknown as NextApiRequest;
    const res = {
      statusCode: 200,
      body: undefined as unknown,
      writableEnded: false,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(value: unknown) {
        this.body = value;
        this.writableEnded = true;
        return this;
      },
      setHeader() {},
      end() {},
      on() {},
    };
    await diagnoseRoute(req, res as unknown as NextApiResponse);
    return res as { statusCode: number; body: { error?: { code: string }; diagnosis?: PlantDiagnosis; demo?: boolean } };
  }

  it("validates the request", async () => {
    expect(PlantDiagnosisRequestSchema.safeParse(body).success).toBe(true);
    expect((await call({ ...body, mediaType: "text/plain" })).statusCode).toBe(400);
    expect((await call({ ...body, place: "roof" })).statusCode).toBe(400);
    expect((await call(body, "GET")).statusCode).toBe(405);
  });

  it("needs an account (401), then the plants feature (403)", async () => {
    state.account = false;
    expect((await call(body)).statusCode).toBe(401);
    state.account = true;
    state.plan = "free";
    const refused = await call(body);
    expect(refused.statusCode).toBe(403);
    expect(refused.body.error?.code).toBe("plan_required");
    state.plan = "lite";
    expect(state.calls).toBe(0);
  });

  it("diagnoses and counts one of the month's scans", async () => {
    const response = await call(body);
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ demo: false, diagnosis: { problem: "Trop d’eau", urgency: "medium" } });
    expect((await getPlanUsage("gardener-1")).scans).toBe(1);
  });

  it("gives the scan back when the AI fails", async () => {
    state.accountId = "gardener-2";
    state.fail = true;
    expect((await call(body)).statusCode).toBe(500);
    expect((await getPlanUsage("gardener-2")).scans).toBe(0);
    state.fail = false;
    state.accountId = "gardener-1";
  });

  it("serves the demo diagnosis without an AI key, even signed out", async () => {
    state.provider = "demo";
    state.account = false;
    const calls = state.calls;
    const response = await call({ ...body, locale: "en" });
    expect(response.statusCode).toBe(200);
    expect(response.body.demo).toBe(true);
    expect(response.body.diagnosis?.problem).toBe("Too much water");
    expect(state.calls).toBe(calls);
    state.provider = "gemini";
    state.account = true;
  });
});
