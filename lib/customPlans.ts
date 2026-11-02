import type { Locale } from "@/i18n.config";
import { customPlanIdPattern, isCustomPlanId, planIds, rankOf, type AnyPlanId, type CustomPlan, type CustomPlanInfo, type PlanId, type PlanName, type PlanResponse } from "./plans";

// The plans created from the Admin, as the app shows them: their id from
// their name, their name in the app's language, their rank among the others.

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Whether `id` is one of the built-in plans (free, Lite, Premium, Pro, Admin). */
export const isBuiltInPlan = (id: AnyPlanId): id is PlanId => (planIds as readonly string[]).includes(id);

/**
 * A short id drawn from a plan's name: "Famille" → "famille", "Étudiant
 * 2026" → "etudiant-2026". Empty when the name gives no valid id (then the
 * Admin types one).
 */
export function planSlug(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .slice(0, 24)
    .replace(/-+$/, "");
  return customPlanIdPattern.test(slug) ? slug : "";
}

/** Why an id can't name a new plan: "format", "builtIn" or "taken"; null when it can. */
export function planIdProblem(id: string, taken: readonly string[]): "format" | "builtIn" | "taken" | null {
  if (!customPlanIdPattern.test(id)) return "format";
  if (!isCustomPlanId(id)) return "builtIn";
  return taken.includes(id) ? "taken" : null;
}

/** The name in the app's language, else the French one. */
export const localName = (name: PlanName, locale: Locale) => name[locale]?.trim() || name.fr;

/** A created plan as the server described it (the account's own, or an offer); null when unknown. */
export function createdPlanInfo(id: AnyPlanId, state: Pick<PlanResponse, "offers" | "customPlan"> | null): CustomPlanInfo | null {
  if (isBuiltInPlan(id) || !state) return null;
  if (state.customPlan?.id === id) return state.customPlan;
  const offer = state.offers?.find((entry) => entry.id === id);
  if (offer?.name && offer.color) return { id, name: offer.name, color: offer.color, rank: offer.rank ?? rankOf(id) };
  return null;
}

/** A plan's name: the locales' for a built-in plan, the Admin's for a created one (its id while unknown). */
export function planName(id: AnyPlanId, t: Translate, locale: Locale, state: Pick<PlanResponse, "offers" | "customPlan"> | null): string {
  if (isBuiltInPlan(id)) return t(`plans.names.${id}`);
  const info = createdPlanInfo(id, state);
  return info ? localName(info.name, locale) : id;
}

/** A plan's name in the Admin, from its own list of created plans (its id for one deleted since). */
export function adminPlanName(id: AnyPlanId, t: Translate, locale: Locale, created: readonly CustomPlan[]): string {
  if (isBuiltInPlan(id)) return t(`plans.names.${id}`);
  const found = created.find((plan) => plan.id === id);
  return found ? localName(found.name, locale) : id;
}

/** A plan's rank among all (the built-in ones', or the server's for a created one); -1 when unknown. */
export function planRankIn(id: AnyPlanId, state: Pick<PlanResponse, "offers" | "customPlan"> | null): number {
  return isBuiltInPlan(id) ? rankOf(id) : (createdPlanInfo(id, state)?.rank ?? -1);
}
