import { describe, expect, it } from "vitest";
import { mockAnalysis, mockPrescription } from "@/lib/ai/mock";
import { analysisShareLines } from "@/lib/shareLines";

const warning = "Ces informations ne remplacent pas l’avis d’un médecin.";

describe("the shared text of a result", () => {
  it("carries the medical warning right after the summary for a prescription", () => {
    const analysis = mockPrescription("fr");
    const lines = analysisShareLines(analysis, warning);
    expect(lines[0]).toBe(analysis.summary);
    expect(lines).toContain(warning);
    expect(lines.indexOf(warning)).toBeLessThan(lines.findIndex((line) => line.startsWith("•")));
  });

  it("adds nothing to the other scans", () => {
    expect(analysisShareLines(mockAnalysis("food", "fr"), warning)).not.toContain(warning);
  });
});
