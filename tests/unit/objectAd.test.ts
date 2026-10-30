import type { NextApiRequest, NextApiResponse } from "next";
import { describe, expect, it, vi } from "vitest";
import { mockAnalysis } from "@/lib/ai/mock";
import { mockObjectAd } from "@/lib/ai/objectAdDemo";
import { buildObjectAdPrompt } from "@/lib/ai/prompt";
import { ObjectAdRequestSchema, ObjectAdSchema, type ObjectAd } from "@/lib/ai/schema";
import { adShareText, guessCondition, roundPrice, tidyAd, whatsappShareUrl } from "@/lib/objectAd";

// The route's dependencies: an AI engine that writes, and the plan of the account.
const state = vi.hoisted(() => ({ provider: "gemini", plan: "free" as string, account: false as boolean, accountId: "user-1", questions: 2, fail: false, calls: 0 }));
vi.mock("@/lib/server/redis", () => ({ redis: null }));
vi.mock("@/lib/ai/provider", () => ({
  get activeProvider() {
    return state.provider;
  },
  writeObjectAd: async () => {
    state.calls += 1;
    if (state.fail) throw new Error("The AI is down.");
    const ad: ObjectAd = { title: " Ventilateur Sonashi ", text: "Bon ventilateur.", price: 61_400, priceLow: 70_000, priceHigh: 55_000, keywords: ["#Ventilateur", "sonashi", "ventilateur"], textMg: " " };
    return { ad, model: "gemini-flash-latest", usage: { inputTokens: 900, outputTokens: 300 } };
  },
}));
vi.mock("@/lib/server/plan", () => ({
  limitsFor: async () => ({ scans: 0, questionsPerDay: state.questions, parcels: 0, deepPerMonth: 0 }),
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

const { default: adRoute } = await import("@/pages/api/objects/ad");
const { getAskUsage, getPlanUsage } = await import("@/lib/server/trialStore");

const object = mockAnalysis("object", "fr");

describe("guessCondition", () => {
  const base = { summary: "Un ventilateur sur pied.", facts: [], tags: ["ventilateur"] };
  it("says good when the analysis says nothing", () => {
    expect(guessCondition(base)).toBe("good");
  });
  it("reads the words of the analysis, worst first", () => {
    expect(guessCondition({ ...base, summary: "Écran fissuré, à réparer." })).toBe("toRepair");
    expect(guessCondition({ ...base, summary: "Quelques rayures sur le côté." })).toBe("worn");
    expect(guessCondition({ ...base, summary: "Il est comme neuf." })).toBe("veryGood");
    expect(guessCondition({ ...base, summary: "Still in its original box, brand new." })).toBe("new");
  });
  it("reads only the facts about the condition, and not the new price", () => {
    expect(guessCondition({ ...base, facts: [{ label: "Prix neuf", value: "Neuf : 200 000 Ar" }] })).toBe("good");
    expect(guessCondition({ ...base, summary: "Le prix neuf est d’environ 200 000 Ar." })).toBe("good");
    expect(guessCondition({ ...base, facts: [{ label: "État", value: "Usé" }] })).toBe("worn");
  });
});

describe("tidyAd and the shared text", () => {
  it("rounds the prices and puts them in order", () => {
    expect(roundPrice(61_400)).toBe(61_000);
    expect(roundPrice(7_300)).toBe(7_500);
    const ad = tidyAd({ title: " Radio ", text: " Bonne radio. ", price: 61_400, priceLow: 70_000, priceHigh: 55_000, keywords: ["#Radio", "radio", "sony", " "], textMg: " " });
    expect(ad).toMatchObject({ title: "Radio", text: "Bonne radio.", price: 61_000, priceLow: 61_000, priceHigh: 61_000, keywords: ["radio", "sony"], textMg: null });
  });

  it("joins the title, the texts, the price and the hashtags", () => {
    const text = adShareText({ title: "Radio", text: "Bonne radio.", price: 60_000, keywords: ["radio", "bon état"], textMg: "Radio tsara." }, "Prix :", "fr");
    expect(text.split("\n\n")).toEqual(["Radio", "Bonne radio.", "Radio tsara.", `Prix : ${new Intl.NumberFormat("fr-FR").format(60_000)} Ar`, "#radio #bonétat"]);
    expect(whatsappShareUrl("a b")).toBe("https://wa.me/?text=a%20b");
  });
});

describe("the demo ad and the prompt", () => {
  it("follows the condition, the place and the Malagasy option", () => {
    const ad = mockObjectAd({ condition: "toRepair", place: "Toamasina", locale: "fr", malagasy: true }, "Ventilateur");
    expect(ObjectAdSchema.safeParse(ad).success).toBe(true);
    expect(ad.price).toBeLessThan(mockObjectAd({ condition: "new", locale: "fr" }, "Ventilateur").price);
    expect(ad.text).toContain("Toamasina");
    expect(ad.textMg).not.toBeNull();
    expect(mockObjectAd({ condition: "good", locale: "en" }, "Fan").textMg).toBeNull();
  });

  it("gives the AI the condition, the place as data, and the language", () => {
    const prompt = buildObjectAdPrompt({ condition: "worn", place: "Fianar", locale: "en", malagasy: true }, object);
    expect(prompt).toContain("worn");
    expect(prompt).toContain('"Fianar"');
    expect(prompt).toContain("English");
    expect(prompt).toContain("Also give textMg");
  });
});

describe("POST /api/objects/ad", () => {
  const installId = "install-object-ad-0001";
  const body = { image: "AAAA", mediaType: "image/jpeg", analysis: object, condition: "good", place: "Antsirabe", locale: "fr" };

  async function call(payload: unknown, { method = "POST", install = installId as string | null } = {}) {
    const req = {
      method,
      headers: install ? { "x-install-id": install } : {},
      body: payload,
      socket: { remoteAddress: `10.3.0.${Math.floor(Math.random() * 250)}` },
    } as unknown as NextApiRequest;
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
    await adRoute(req, res as unknown as NextApiResponse);
    return res as { statusCode: number; body: { error?: { code: string }; ad?: ObjectAd; demo?: boolean; usage?: { used: number; limit: number } } };
  }

  it("validates the request", async () => {
    expect(ObjectAdRequestSchema.safeParse(body).success).toBe(true);
    expect((await call({ ...body, condition: "broken" })).statusCode).toBe(400);
    expect((await call({ ...body, analysis: { title: "x" } })).statusCode).toBe(400);
    expect((await call({ ...body, place: "x".repeat(61) })).statusCode).toBe(400);
    expect((await call(body, { method: "GET" })).statusCode).toBe(405);
    expect((await call(body, { install: null })).statusCode).toBe(400);
    expect(state.calls).toBe(0);
  });

  it("writes the ad, tidied, and counts one of the day's questions of the install", async () => {
    const response = await call(body);
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ demo: false, ad: { title: "Ventilateur Sonashi", price: 61_000, keywords: ["ventilateur", "sonashi"], textMg: null }, usage: { used: 1 } });
    expect(await getAskUsage(installId)).toBe(1);
  });

  it("gives the question back when the AI fails", async () => {
    state.fail = true;
    expect((await call(body)).statusCode).toBe(500);
    expect(await getAskUsage(installId)).toBe(1);
    state.fail = false;
  });

  it("draws on a subscriber's daily questions, and refuses once they are used up (403)", async () => {
    state.plan = "premium";
    state.account = true;
    state.accountId = "seller-1";
    expect((await call(body)).statusCode).toBe(200);
    expect((await call(body)).statusCode).toBe(200);
    const refused = await call(body);
    expect(refused.statusCode).toBe(403);
    expect(refused.body.error?.code).toBe("ask_limit");
    expect((await getPlanUsage("seller-1")).questionsToday).toBe(2);
    state.plan = "free";
    state.account = false;
  });

  it("serves the demo ad without an AI key, without counting", async () => {
    state.provider = "demo";
    const calls = state.calls;
    const response = await call({ ...body, condition: "worn" }, { install: null });
    expect(response.statusCode).toBe(200);
    expect(response.body.demo).toBe(true);
    expect(response.body.ad?.text).toContain("Antsirabe");
    expect(response.body.ad?.price).toBe(70_000);
    expect(state.calls).toBe(calls);
    state.provider = "gemini";
  });
});
