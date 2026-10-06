import { motion } from "motion/react";
import type { Analysis } from "@/lib/ai/schema";
import { useTranslation } from "@/hooks/useTranslation";
import { formatNumber } from "@/lib/format";
import { easeOut } from "@/lib/motion";
import { CountUp } from "./CountUp";
import styles from "./Result.module.scss";

type Nutrition = NonNullable<Analysis["nutrition"]>;

// kcal per gram, used to show each macro's share of the energy.
const energyPerGram = { proteinG: 4, carbsG: 4, fatG: 9 } as const;

const macros = [
  { key: "proteinG", label: "result.protein", color: "var(--cat-document)" },
  { key: "carbsG", label: "result.carbs", color: "var(--cat-food)" },
  { key: "fatG", label: "result.fat", color: "var(--cat-object)" },
] as const;

const RADIUS = 26;

export function NutritionCard({ nutrition }: { nutrition: Nutrition }) {
  const { t, locale } = useTranslation();
  const totalEnergy = macros.reduce((sum, macro) => sum + nutrition[macro.key] * energyPerGram[macro.key], 0) || 1;

  return (
    <div className={styles.nutrition}>
      <div className={styles.kcal}>
        <strong>
          <CountUp value={nutrition.calories} format={(v) => formatNumber(v, locale)} />
        </strong>
        <span>{t("result.kcal")}</span>
        <small>{nutrition.portion}</small>
      </div>
      <div className={styles.rings}>
        {macros.map((macro, index) => {
          const grams = nutrition[macro.key];
          const share = (grams * energyPerGram[macro.key]) / totalEnergy;
          return (
            <div key={macro.key} className={styles.ring}>
              <svg viewBox="0 0 64 64" aria-hidden>
                <circle cx="32" cy="32" r={RADIUS} className={styles.ringTrack} />
                <motion.circle
                  cx="32"
                  cy="32"
                  r={RADIUS}
                  className={styles.ringValue}
                  style={{ stroke: macro.color }}
                  initial={{ pathLength: 0 }}
                  whileInView={{ pathLength: Math.max(share, 0.02) }}
                  viewport={{ once: true }}
                  transition={{ duration: 1.2, ease: easeOut, delay: 0.15 + index * 0.12 }}
                />
              </svg>
              <span className={styles.ringValueText}>
                <CountUp value={grams} />g
              </span>
              <span className={styles.ringLabel}>{t(macro.label)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
