import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { AnalysisSchema } from "@/lib/ai/schema";
import { mockAnalysis } from "@/lib/ai/mock";
import { historyStore } from "@/services/historyStore";
import type { HistoryEntry } from "@/types/history";

// A scan as an older version saved it: none of the fields added since.
function oldEntry(id: string, mode: "food" | "document"): HistoryEntry {
  const analysis: Record<string, unknown> = { ...mockAnalysis(mode, "fr") };
  delete analysis.questions;
  delete analysis.diet;
  if (analysis.document) {
    const document: Record<string, unknown> = { ...(analysis.document as object) };
    delete document.paper;
    delete document.bill;
    analysis.document = document;
  }
  return {
    id,
    createdAt: 1000,
    mode,
    thumbnail: "data:image/jpeg;base64,AA",
    preview: "data:image/jpeg;base64,AA",
    analysis: analysis as HistoryEntry["analysis"],
    meta: { model: "demo", demo: true, durationMs: 1 },
  };
}

describe("scans saved by an older version", () => {
  it("are read with the fields added since, so screens can use them", async () => {
    await historyStore.rawPut(oldEntry("old-food", "food"), { silent: true });
    await historyStore.rawPut(oldEntry("old-doc", "document"), { silent: true });

    const food = await historyStore.get("old-food");
    expect(food?.analysis.questions).toEqual([]);
    expect(food?.analysis.diet).toBeNull();

    const document = (await historyStore.list()).find((entry) => entry.id === "old-doc");
    expect(document?.analysis.document).toMatchObject({ paper: null, bill: null });
    expect(AnalysisSchema.safeParse(document?.analysis).success).toBe(true);

    expect((await historyStore.raw()).every((entry) => Array.isArray(entry.analysis.questions))).toBe(true);
    expect((await historyStore.rawGet("old-food"))?.analysis.questions).toEqual([]);
  });

  it("keep what they already have", async () => {
    const recent = { ...oldEntry("recent", "food"), analysis: mockAnalysis("food", "fr") };
    await historyStore.rawPut(recent, { silent: true });
    expect((await historyStore.get("recent"))?.analysis).toEqual(recent.analysis);
  });
});
