import Link from "next/link";
import { motion } from "motion/react";
import { ExternalLink, Gift, KeyRound } from "lucide-react";
import { Button } from "@/components/Button";
import { useTranslation } from "@/hooks/useTranslation";
import { spring } from "@/lib/motion";
import styles from "./Trial.module.scss";

export const AI_SETTINGS_HREF = "/settings?section=ai";

/** "Free trial · 2/3 left" with one dot per scan. */
export function TrialPill({ remaining, limit }: { remaining: number; limit: number }) {
  const { t } = useTranslation();
  return (
    <Link href={AI_SETTINGS_HREF} className={styles.pill}>
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

/** Replaces the capture controls once the free scans are used up. */
export function TrialOver({ limit }: { limit: number }) {
  const { t } = useTranslation();
  return (
    <motion.div
      className={styles.over}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={spring}
      role="region"
      aria-labelledby="trial-over-title"
    >
      <span className={styles.icon} aria-hidden>
        <KeyRound size={30} />
      </span>
      <h2 id="trial-over-title">{t("trial.overTitle")}</h2>
      <p>{t("trial.overBody", { limit })}</p>
      <Button href={AI_SETTINGS_HREF} size="lg" icon={<KeyRound />} block>
        {t("trial.addKey")}
      </Button>
      <a className={styles.link} href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">
        {t("trial.freeKey")} <ExternalLink size={13} />
      </a>
    </motion.div>
  );
}
