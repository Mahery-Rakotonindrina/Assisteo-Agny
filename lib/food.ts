import type { Allergen, Analysis, Diet } from "@/lib/ai/schema";
import { startOfDay } from "@/lib/format";

// Food helpers: the user's allergies and diets checked against a scan, and
// the food journal (what was eaten, day by day, against daily goals).

/** Daily targets of the food journal. */
export type FoodGoals = { calories: number; proteinG: number; carbsG: number; fatG: number };

/** A common adult reference; each user can change it. */
export const defaultFoodGoals: FoodGoals = { calories: 2000, proteinG: 60, carbsG: 260, fatG: 70 };

export const mealKinds = ["breakfast", "lunch", "dinner", "snack"] as const;
export type MealKind = (typeof mealKinds)[number];

/** One time a scanned food was eaten: `portions` of the portion the analysis estimated. */
export type MealLog = { id: string; at: number; meal: MealKind; portions: number };

/** Portions offered when logging a meal. */
export const portionChoices = [0.5, 1, 1.5, 2] as const;

/** The meal a time of day most likely is. */
export function mealAt(timestamp: number): MealKind {
  const hour = new Date(timestamp).getHours();
  if (hour >= 4 && hour < 11) return "breakfast";
  if (hour >= 11 && hour < 15) return "lunch";
  if (hour >= 18 && hour < 23) return "dinner";
  return "snack";
}

/** Logging on another day: at the same time of day as now. */
export function sameTimeOn(day: number, now = Date.now()) {
  return startOfDay(day) + (now - startOfDay(now));
}

type Profile = { allergies: readonly Allergen[]; diets: readonly Diet[] };

/**
 * What in a food goes against the user's profile: their allergens it contains,
 * their diets it doesn't fit, and those it may not fit.
 */
export function dietAlerts(diet: Analysis["diet"], profile: Profile) {
  if (!diet) return { allergens: [], against: [], unsure: [] };
  const fits = (value: Diet) => diet.diets.find((item) => item.diet === value)?.fits;
  return {
    allergens: diet.allergens.filter((allergen) => profile.allergies.includes(allergen)),
    against: profile.diets.filter((value) => fits(value) === "no"),
    unsure: profile.diets.filter((value) => fits(value) === "unsure"),
  };
}

/** Anything worth a warning on the result. */
export function hasDietAlert(alerts: ReturnType<typeof dietAlerts>) {
  return alerts.allergens.length > 0 || alerts.against.length > 0;
}

type Nutrition = NonNullable<Analysis["nutrition"]>;
export type Intake = Pick<Nutrition, "calories" | "proteinG" | "carbsG" | "fatG">;

const zero: Intake = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 };

/** What `portions` of an estimate amount to. */
export function scaleIntake(nutrition: Intake, portions: number): Intake {
  return {
    calories: nutrition.calories * portions,
    proteinG: nutrition.proteinG * portions,
    carbsG: nutrition.carbsG * portions,
    fatG: nutrition.fatG * portions,
  };
}

type Loggable = { id: string; analysis: Pick<Analysis, "nutrition">; meals?: MealLog[] };

export type JournalItem<T extends Loggable> = { entry: T; log: MealLog; intake: Intake };

/** The meals of the day containing `day`, in the order eaten. */
export function journalDay<T extends Loggable>(entries: T[], day: number): JournalItem<T>[] {
  const start = startOfDay(day);
  const items: JournalItem<T>[] = [];
  for (const entry of entries) {
    if (!entry.analysis.nutrition) continue;
    for (const log of entry.meals ?? []) {
      if (startOfDay(log.at) === start) items.push({ entry, log, intake: scaleIntake(entry.analysis.nutrition, log.portions) });
    }
  }
  return items.sort((a, b) => a.log.at - b.log.at);
}

/** The sum of a day's intakes. */
export function totalIntake(items: Array<{ intake: Intake }>): Intake {
  return items.reduce(
    (total, { intake }) => ({
      calories: total.calories + intake.calories,
      proteinG: total.proteinG + intake.proteinG,
      carbsG: total.carbsG + intake.carbsG,
      fatG: total.fatG + intake.fatG,
    }),
    zero,
  );
}

/** A goal is valid when every value is a positive number. */
export function cleanGoals(goals: Partial<Record<keyof FoodGoals, number>>): FoodGoals {
  const pick = (key: keyof FoodGoals) => {
    const value = Math.round(Number(goals[key]));
    return Number.isFinite(value) && value > 0 ? Math.min(value, 20_000) : defaultFoodGoals[key];
  };
  return { calories: pick("calories"), proteinG: pick("proteinG"), carbsG: pick("carbsG"), fatG: pick("fatG") };
}
