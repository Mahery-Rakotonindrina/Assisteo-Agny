import { Briefcase, Crown, Gift, Infinity as InfinityIcon, Zap, type LucideIcon } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import type { PlanId } from "@/lib/plans";
import styles from "./PlanBadge.module.scss";

/** Each plan's icon; its colour comes from [data-plan] (styles/globals.scss). */
const icons: Record<PlanId, LucideIcon> = { free: Gift, lite: Zap, premium: Crown, pro: Briefcase, unlimited: InfinityIcon };

export function PlanIcon({ plan, size = 16 }: { plan: PlanId; size?: number }) {
  const Icon = icons[plan];
  return <Icon size={size} aria-hidden />;
}

/** The plan's name with its icon and colour: "♛ Premium". */
export function PlanBadge({ plan, size = "sm", className }: { plan: PlanId; size?: "sm" | "md"; className?: string }) {
  const { t } = useTranslation();
  return (
    <span data-plan={plan} data-size={size} className={[styles.badge, className].filter(Boolean).join(" ")}>
      <PlanIcon plan={plan} size={size === "md" ? 15 : 12} />
      {t(`plans.names.${plan}`)}
    </span>
  );
}
