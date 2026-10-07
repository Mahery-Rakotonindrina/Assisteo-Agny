import { describe, expect, it } from "vitest";
import { mockAnalysis } from "@/lib/ai/mock";
import { AnalysisSchema, AskRequestSchema, normalizeStoredAnalysis, scanModes } from "@/lib/ai/schema";

describe("AnalysisSchema", () => {
  it.each(scanModes.filter((mode) => mode !== "auto"))("accepts the %s demo analysis in both languages", (mode) => {
    for (const locale of ["fr", "en"] as const) {
      expect(AnalysisSchema.safeParse(mockAnalysis(mode, locale)).success).toBe(true);
    }
  });

  it("upgrades analyses stored before recipes, vehicles and document dates existed", () => {
    const old = { ...mockAnalysis("document", "fr") } as Record<string, unknown>;
    delete old.recipe;
    delete old.vehicle;
    old.document = { type: "Facture", keyPoints: [], dates: [], actionItems: [] };
    const upgraded = AnalysisSchema.safeParse(normalizeStoredAnalysis(old));
    expect(upgraded.success).toBe(true);
    expect(upgraded.data?.document?.expiresOn).toBeNull();
    expect(upgraded.data?.document?.isInsurance).toBe(false);
  });
});

describe("AskRequestSchema", () => {
  const base = { image: "aGVsbG8=", mediaType: "image/jpeg", analysis: {}, locale: "fr" } as const;
  it("requires the last message to be the user's", () => {
    expect(AskRequestSchema.safeParse({ ...base, messages: [{ role: "user", content: "Combien ?" }] }).success).toBe(true);
    expect(AskRequestSchema.safeParse({ ...base, messages: [{ role: "assistant", content: "Bonjour" }] }).success).toBe(false);
  });
});
