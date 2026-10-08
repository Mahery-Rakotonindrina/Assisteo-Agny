import Link from "next/link";
import { motion } from "motion/react";
import { CalendarClock, Gift, KeyRound, Sparkles } from "lucide-react";
import { Button } from "@/components/Button";
import { useTranslation } from "@/hooks/useTranslation";
import type { PlanId } from "@/lib/plans";
import { spring } from "@/lib/motion";
import styles from "./Trial.module.scss";

export const AI_SETTINGS_HREF = "/settings?section=ai";
export const PLANS_HREF = "/plans";

/** Free trial: "Free trial · 2/3" with one dot per scan. A plan: "8 scans left this month". */
export function TrialPill({ remaining, limit, kind }: { remaining: number; limit: number; kind: "trial" | "month" }) {
  const { t } = useTranslation();
  if (kind === "month") {
    return (
      <Link href={PLANS_HREF} className={styles.pill}>
        <CalendarClock size={15} />
        <span>{t("trial.pillMonth", { remaining })}</span>
      </Link>
    );
  }
  return (
    <Link href={PLANS_HREF} className={styles.pill}>
      <Gift size={15} />
      <span>{t("trial.pill", { remaining, limit })}</span>
      <span className={styles.dots} aria-hidden>
        {Array.from({ length: limit }, (_, index) => (
          <motion.i
            key={index}
            className={index < remaining ? styles.left : undefined}
            initial={false}
            animate={{ scale: index < remaining ? 1 : 0.8 }}
            transition={spring}
          />
        ))}
      </span>
    </Link>
  );
}

/** Replaces the capture controls once the free scans, or this month's, are used up. */
export function TrialOver({ limit, kind, plan, canUseOwnKey }: { limit: number; kind: "trial" | "month"; plan: PlanId; canUseOwnKey: boolean }) {
  const { t } = useTranslation();
  return (
    <motion.div
      className={styles.over}
      data-plan={kind === "month" ? plan : undefined}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={spring}
      role="region"
      aria-labelledby="trial-over-title"
    >
      <span className={styles.icon} aria-hidden>
        {kind === "trial" ? <Gift size={30} /> : <CalendarClock size={30} />}
      </span>
      <h2 id="trial-over-title">{kind === "trial" ? t("trial.overTitle") : t("trial.overTitleMonth")}</h2>
      <p>{kind === "trial" ? t("trial.overBody", { limit }) : t("trial.overBodyMonth", { limit, plan: t(`plans.names.${plan}`) })}</p>
      <Button href={PLANS_HREF} size="lg" icon={<Sparkles />} block>
        {t("trial.seeOffers")}
      </Button>
      {canUseOwnKey && (
        <Button href={AI_SETTINGS_HREF} variant="ghost" icon={<KeyRound />} block>
          {t("trial.useOwnKey")}
        </Button>
      )}
    </motion.div>
  );
}
