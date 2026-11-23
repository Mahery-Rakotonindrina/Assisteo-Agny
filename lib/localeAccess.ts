import { defaultLocale, type Locale } from "@/i18n.config";
import { planAllows, type PlanResponse } from "./plans";

/** Languages behind a plan feature (Admin → Features): without it the app stays in French. */
const gatedLocales: Partial<Record<Locale, "malagasy">> = { mg: "malagasy" };

/** Whether the account may use a language: always, unless a feature gates it. */
export function localeAllowed(locale: Locale, has: (feature: "malagasy") => boolean) {
  const feature = gatedLocales[locale];
  return !feature || has(feature);
}

/** The language really shown: the chosen one, or French when a feature it needs is missing. */
export function effectiveLocale(locale: Locale, has: (feature: "malagasy") => boolean): Locale {
  return localeAllowed(locale, has) ? locale : defaultLocale;
}

/** The same from the plan the app knows (null until known: the free plan). */
export function effectiveLocaleFor(locale: Locale, plan: Pick<PlanResponse, "plan" | "features"> | null): Locale {
  return effectiveLocale(locale, (feature) => planAllows(plan, feature));
}
