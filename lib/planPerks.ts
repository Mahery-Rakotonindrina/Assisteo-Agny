import type { Locale } from "@/i18n.config";
import { formatNumber } from "./format";
import { hasFeature, planFeatures, type PlanFeature, type PlanId, type PlanLimits } from "./plans";

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** The lines of each feature, in plain words (deep analyses: the month's count, then the priority). */
function featureLines(feature: PlanFeature, deepPerMonth: number, t: Translate, locale: Locale, deepCount = true): string[] {
  switch (feature) {
    case "deepAnalysis":
      return [...(deepCount ? [deepLine(deepPerMonth, t, locale)] : []), t("plans.features.priority")];
    case "reseller":
      return [t("plans.features.clients"), t("plans.features.reseller")];
    default:
      return [t(`plans.features.${feature}`)];
  }
}

const deepLine = (value: number, t: Translate, locale: Locale) =>
  value === 0 ? t("plans.features.deepUnlimited") : t("plans.features.deep", { count: formatNumber(value, locale) });

/**
 * What a plan includes, in plain words: its limits, then its features. `has`
 * is what the account may use (usePlan); the built-in ladder by default.
 */
export function planPerks(plan: PlanId, limits: PlanLimits, t: Translate, locale: Locale, has: (feature: PlanFeature) => boolean = (feature) => hasFeature(plan, feature)): string[] {
  if (plan === "unlimited") return [t("plans.perks.everything"), t("plans.perks.adminMenu")];
  const limit = (value: number, key: "scans" | "questions" | "parcels" | "deep") =>
    value === 0 ? t(`plans.features.${key}Unlimited`) : t(`plans.features.${key}`, { count: formatNumber(value, locale) });
  const perks =
    plan === "free"
      ? [t("plans.perks.trialScans", { count: limits.scans }), limit(limits.questionsPerDay, "questions"), limit(limits.parcels, "parcels")]
      : [limit(limits.scans, "scans"), limit(limits.questionsPerDay, "questions"), limit(limits.parcels, "parcels")];
  for (const feature of planFeatures) if (has(feature)) perks.push(...featureLines(feature, limits.deepPerMonth, t, locale));
  return perks;
}

/**
 * An offer's lines on the offers page: "All Lite, and:" when it includes the
 * offer below, then its limits, then what it adds. The deep analyses' count
 * is a limit of its own: shown on every offer that has them.
 */
export function offerLines(
  offer: { id: PlanId; features: readonly PlanFeature[]; deepPerMonth: number },
  below: { id: "lite" | "premium"; features: readonly PlanFeature[] } | null,
  limitLines: string[],
  t: Translate,
  locale: Locale,
): Array<{ text: string; inherit?: boolean }> {
  const includesBelow = below !== null && below.features.every((feature) => offer.features.includes(feature));
  const added = offer.features.filter((feature) => !includesBelow || !below.features.includes(feature));
  const deep = offer.features.includes("deepAnalysis") ? [deepLine(offer.deepPerMonth, t, locale)] : [];
  return [
    ...(includesBelow ? [{ text: t(below.id === "lite" ? "plans.features.allLite" : "plans.features.allPremium"), inherit: true }] : []),
    ...[...limitLines, ...deep, ...added.flatMap((feature) => featureLines(feature, offer.deepPerMonth, t, locale, false))].map((text) => ({ text })),
  ];
}
