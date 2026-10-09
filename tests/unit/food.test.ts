import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { AnalysisSchema, normalizeStoredAnalysis } from "@/lib/ai/schema";
import { mockAnalysis } from "@/lib/ai/mock";
import { dietAlerts, hasDietAlert } from "@/lib/food";

const food = mockAnalysis("food", "fr");

describe("allergens and diets", () => {
  it("flags the user's allergens and the diets the food doesn't fit", () => {
    const alerts = dietAlerts(food.diet, { allergies: ["milk", "peanuts"], diets: ["vegan", "halal", "low_salt"] });
    expect(alerts).toEqual({ allergens: ["milk"], against: ["vegan"], unsure: ["low_salt"] });
    expect(hasDietAlert(alerts)).toBe(true);
    expect(hasDietAlert(dietAlerts(food.diet, { allergies: ["fish"], diets: ["vegetarian"] }))).toBe(false);
    expect(hasDietAlert(dietAlerts(null, { allergies: ["milk"], diets: [] }))).toBe(false);
  });

  it("still reads analyses saved before diets existed", () => {
    const old: Record<string, unknown> = { ...food };
    delete old.diet;
    expect(AnalysisSchema.safeParse(normalizeStoredAnalysis(old)).success).toBe(true);
  });
});
