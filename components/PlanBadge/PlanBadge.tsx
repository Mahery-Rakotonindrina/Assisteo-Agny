import { Briefcase, Crown, Gift, ShieldCheck, Sparkles, Zap, type LucideIcon } from "lucide-react";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { createdPlanInfo, isBuiltInPlan, localName } from "@/lib/customPlans";
import type { AnyPlanId, CustomPlanInfo, PlanId } from "@/lib/plans";
import styles from "./PlanBadge.module.scss";

/** Each plan's icon; its colour comes from [data-plan] (styles/globals.scss), a created plan's from [data-plan-color] (styles/planColors.scss). */
const icons: Record<PlanId, LucideIcon> = { free: Gift, lite: Zap, premium: Crown, pro: Briefcase, unlimited: ShieldCheck };

export function PlanIcon({ plan, size = 16 }: { plan: AnyPlanId; size?: number }) {
  const Icon = isBuiltInPlan(plan) ? icons[plan] : Sparkles;
  return <Icon size={size} aria-hidden />;
}

/**
 * The plan's name with its icon and colour: "♛ Premium". Nothing for no plan
 * (a feature no plan offers now). A created plan's name and colour come from
 * the server (`usePlan`), or from `custom` (the Admin's own list).
 */
export function PlanBadge({
  plan,
  size = "sm",
  className,
  custom,
}: {
  plan: AnyPlanId | null;
  size?: "sm" | "md";
  className?: string;
  custom?: Pick<CustomPlanInfo, "name" | "color"> | null;
}) {
  const { t, locale } = useTranslation();
  const { plan: state } = usePlan();
  if (plan === null) return null;
  const info = isBuiltInPlan(plan) ? null : (custom ?? createdPlanInfo(plan, state));
  return (
    <span data-plan={plan} data-plan-color={info?.color} data-size={size} className={[styles.badge, className].filter(Boolean).join(" ")}>
      <PlanIcon plan={plan} size={size === "md" ? 15 : 12} />
      {isBuiltInPlan(plan) ? t(`plans.names.${plan}`) : info ? localName(info.name, locale) : plan}
    </span>
  );
}
