import { mealAt, type MealLog } from "@/lib/food";
import { createId, historyStore } from "./historyStore";

// The food journal lives on the food scans themselves (HistoryEntry.meals):
// it syncs with the history and goes away with the scan.

async function changeMeals(entryId: string, update: (meals: MealLog[]) => MealLog[]) {
  const entry = await historyStore.get(entryId);
  if (!entry) return;
  await historyStore.update(entryId, { meals: update(entry.meals ?? []) });
}

export const foodJournal = {
  /** Logs that this food was eaten (now by default). */
  add: (entryId: string, meal: Partial<Omit<MealLog, "id">> = {}) => {
    const at = meal.at ?? Date.now();
    return changeMeals(entryId, (meals) => [...meals, { id: createId(), at, meal: meal.meal ?? mealAt(at), portions: meal.portions ?? 1 }]);
  },

  edit: (entryId: string, logId: string, patch: Partial<Omit<MealLog, "id">>) =>
    changeMeals(entryId, (meals) => meals.map((log) => (log.id === logId ? { ...log, ...patch } : log))),

  remove: (entryId: string, logId: string) => changeMeals(entryId, (meals) => meals.filter((log) => log.id !== logId)),
};
