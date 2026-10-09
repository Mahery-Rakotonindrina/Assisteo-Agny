import type { Allergen, Analysis, Diet } from "@/lib/ai/schema";

// Food helpers: the user's allergies and diets checked against a scan.

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
