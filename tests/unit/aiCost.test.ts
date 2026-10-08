import { describe, expect, it } from "vitest";
import { costsByKind, defaultAiPrices, planWorstCaseUsd, priceFor, usageRows } from "@/lib/aiCost";

describe("AI cost", () => {
  it("reads the token counters of several days", () => {
    const rows = usageRows([
      { scans: 3, "ai:scan:gemini-3.5-flash-lite:calls": 2, "ai:scan:gemini-3.5-flash-lite:in": 3000, "ai:scan:gemini-3.5-flash-lite:out": 1000 },
      { "ai:scan:gemini-3.5-flash-lite:calls": 1, "ai:scan:gemini-3.5-flash-lite:in": 1500, "ai:scan:gemini-3.5-flash-lite:out": 500, "ai:question:gemini-3.8-flash:calls": 4 },
    ]);
    expect(rows).toEqual([
      { kind: "scan", model: "gemini-3.5-flash-lite", calls: 3, inputTokens: 4500, outputTokens: 1500 },
      { kind: "question", model: "gemini-3.8-flash", calls: 4, inputTokens: 0, outputTokens: 0 },
    ]);
  });

  it("prices a model by the most precise name it contains", () => {
    expect(priceFor("gemini-3.5-flash-lite", defaultAiPrices)?.match).toBe("flash-lite");
    expect(priceFor("gemini-3.8-flash", defaultAiPrices)?.match).toBe("flash");
    expect(priceFor("gemini-3.1-pro-preview", defaultAiPrices)?.match).toBe("pro");
    expect(priceFor("claude-opus-5-5", defaultAiPrices)?.match).toBe("claude-opus");
    expect(priceFor("mystery-model", defaultAiPrices)).toBeNull();
  });

  it("costs each kind of call and a plan used to the full", () => {
    const costs = costsByKind(
      [
        { kind: "scan", model: "gemini-3.5-flash-lite", calls: 10, inputTokens: 1_000_000, outputTokens: 500_000 },
        { kind: "question", model: "mystery-model", calls: 2, inputTokens: 100, outputTokens: 100 },
      ],
      defaultAiPrices,
    );
    // 1M in × $0.10 + 0.5M out × $0.40 = $0.30 for 10 scans.
    expect(costs[0]).toMatchObject({ kind: "scan", calls: 10, unpriced: [] });
    expect(costs[0].usdPerCall).toBeCloseTo(0.03);
    expect(costs[2]).toMatchObject({ kind: "question", calls: 2, usd: 0, unpriced: ["mystery-model"] });
    expect(planWorstCaseUsd({ priceMga: 5000, scans: 60, questionsPerDay: 10, parcels: 15, deepPerMonth: 0 }, costs)).toBeCloseTo(1.8);
  });
});
