import type { Locale } from "@/i18n.config";
import { formatNumber } from "./format";
import { hasFeature, type PlanId, type PlanLimits } from "./plans";

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** What a plan includes, in plain words: its limits, then its features. */
export function planPerks(plan: PlanId, limits: PlanLimits, t: Translate, locale: Locale): string[] {
  if (plan === "unlimited") return [t("plans.perks.everything"), t("plans.perks.adminMenu")];
  const limit = (value: number, key: "scans" | "questions" | "parcels" | "deep") =>
    value === 0 ? t(`plans.features.${key}Unlimited`) : t(`plans.features.${key}`, { count: formatNumber(value, locale) });
  const perks =
    plan === "free"
      ? [t("plans.perks.trialScans", { count: limits.scans }), limit(limits.questionsPerDay, "questions"), limit(limits.parcels, "parcels")]
      : [limit(limits.scans, "scans"), limit(limits.questionsPerDay, "questions"), limit(limits.parcels, "parcels")];
  if (hasFeature(plan, "parcelCosts")) perks.push(t("plans.features.parcelCosts"));
  if (hasFeature(plan, "ownKey")) perks.push(t("plans.features.ownKey"));
  if (hasFeature(plan, "deepAnalysis")) perks.push(limit(limits.deepPerMonth, "deep"), t("plans.features.priority"));
  if (hasFeature(plan, "multiPage")) perks.push(t("plans.features.multiPage"));
  if (hasFeature(plan, "reseller")) perks.push(t("plans.features.clients"), t("plans.features.reseller"));
  return perks;
}
