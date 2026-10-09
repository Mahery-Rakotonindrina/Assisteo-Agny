import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { AnalysisSchema, normalizeStoredAnalysis } from "@/lib/ai/schema";
import { mockAnalysis } from "@/lib/ai/mock";
import { dietAlerts, hasDietAlert } from "@/lib/food";
import { listStore } from "@/services/listStore";
import type { HistoryEntry } from "@/types/history";

const food = mockAnalysis("food", "fr");
const entry = (id: string): HistoryEntry => ({
  id,
  createdAt: 1000,
  mode: "food",
  thumbnail: "data:image/jpeg;base64,AA",
  preview: "data:image/jpeg;base64,AA",
  analysis: food,
  meta: { model: "demo", demo: true, durationMs: 1 },
});

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

describe("recipe to shopping list", () => {
  beforeEach(async () => {
    await listStore.wipe();
  });

  it("makes a shopping list of the ingredients, linked to the scan", async () => {
    const list = await listStore.addFromRecipe(entry("r"), "Courses : bowl");
    expect(list).toMatchObject({ title: "Courses : bowl", kind: "shopping", scanId: "r" });
    expect(list.items).toHaveLength(food.recipe!.ingredients.length);
    expect(list.items[0]).toMatchObject({ text: "Pois chiches cuits", quantity: "240 g", done: false });
  });

  it("adds ingredients to a list without repeating those still to buy", async () => {
    const { id } = await listStore.create("Semaine");
    await listStore.addItem(id, "feta");
    expect(await listStore.addItems(id, [{ name: "Feta", quantity: "80 g" }, { name: "Citron", quantity: "½" }])).toBe(1);
    const [list] = await listStore.list();
    expect(list.items.map((item) => item.text)).toEqual(["feta", "Citron"]);
  });
});
