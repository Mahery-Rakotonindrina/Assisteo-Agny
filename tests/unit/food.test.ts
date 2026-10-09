import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { AnalysisSchema, normalizeStoredAnalysis } from "@/lib/ai/schema";
import { mockAnalysis } from "@/lib/ai/mock";
import { cleanGoals, defaultFoodGoals, dietAlerts, hasDietAlert, journalDay, mealAt, totalIntake } from "@/lib/food";
import { foodJournal } from "@/services/foodJournal";
import { historyStore } from "@/services/historyStore";
import { listStore } from "@/services/listStore";
import type { HistoryEntry } from "@/types/history";

const food = mockAnalysis("food", "fr");
const entry = (id: string, meals?: HistoryEntry["meals"]): HistoryEntry => ({
  id,
  createdAt: 1000,
  mode: "food",
  thumbnail: "data:image/jpeg;base64,AA",
  preview: "data:image/jpeg;base64,AA",
  analysis: food,
  meta: { model: "demo", demo: true, durationMs: 1 },
  meals,
});
const at = (day: number, hour: number) => new Date(2026, 9, day, hour).getTime();

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

describe("food journal", () => {
  it("guesses the meal from the time of day", () => {
    expect([at(9, 7), at(9, 12), at(9, 16), at(9, 20), at(9, 1)].map(mealAt)).toEqual(["breakfast", "lunch", "snack", "dinner", "snack"]);
  });

  it("sums a day's meals, portions included", () => {
    const entries = [
      entry("a", [
        { id: "1", at: at(9, 12), meal: "lunch", portions: 1 },
        { id: "2", at: at(10, 12), meal: "lunch", portions: 1 },
      ]),
      entry("b", [{ id: "3", at: at(9, 20), meal: "dinner", portions: 0.5 }]),
    ];
    const day = journalDay(entries, at(9, 23));
    expect(day.map((item) => item.log.id)).toEqual(["1", "3"]);
    expect(totalIntake(day).calories).toBe(food.nutrition!.calories * 1.5);
    expect(journalDay(entries, at(11, 8))).toEqual([]);
  });

  it("keeps sensible goals", () => {
    expect(cleanGoals({ calories: 1800.4, proteinG: -3, carbsG: Number.NaN, fatG: 50 })).toEqual({
      calories: 1800,
      proteinG: defaultFoodGoals.proteinG,
      carbsG: defaultFoodGoals.carbsG,
      fatG: 50,
    });
  });

  it("logs, edits and removes meals on the scan", async () => {
    await historyStore.wipe();
    await historyStore.save(entry("m"));
    await foodJournal.add("m", { at: at(9, 12), portions: 2 });
    let [log] = (await historyStore.get("m"))!.meals!;
    expect(log).toMatchObject({ meal: "lunch", portions: 2 });
    await foodJournal.edit("m", log.id, { portions: 1 });
    [log] = (await historyStore.get("m"))!.meals!;
    expect(log.portions).toBe(1);
    await foodJournal.remove("m", log.id);
    expect((await historyStore.get("m"))!.meals).toEqual([]);
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
