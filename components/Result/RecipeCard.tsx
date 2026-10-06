import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { ChefHat, Check, Flame, Lightbulb, Timer, Users } from "lucide-react";
import type { Analysis } from "@/lib/ai/schema";
import { useTranslation } from "@/hooks/useTranslation";
import { easeOut, spring } from "@/lib/motion";
import { haptics } from "@/services/device";
import styles from "./Recipe.module.scss";

type Recipe = NonNullable<Analysis["recipe"]>;

const difficultyLevel = { easy: 1, medium: 2, hard: 3 } as const;

export function RecipeCard({ recipe }: { recipe: Recipe }) {
  const { t } = useTranslation();
  // Ticking ingredients off while cooking; deliberately not persisted.
  const [checked, setChecked] = useState<Set<number>>(() => new Set());

  const toggle = (index: number) => {
    haptics.tap();
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <div className={styles.recipe}>
      <div className={styles.head}>
        <span className={styles.hat} aria-hidden>
          <ChefHat size={22} />
        </span>
        <h3>{recipe.name}</h3>
      </div>

      <ul className={styles.meta}>
        <li>
          <Timer size={15} />
          <span>
            <small>{t("result.recipePrep")}</small>
            {t("result.minutes", { count: recipe.prepMinutes })}
          </span>
        </li>
        {recipe.cookMinutes > 0 && (
          <li>
            <Flame size={15} />
            <span>
              <small>{t("result.recipeCook")}</small>
              {t("result.minutes", { count: recipe.cookMinutes })}
            </span>
          </li>
        )}
        <li>
          <Users size={15} />
          <span>
            <small>{t("result.recipeServings")}</small>
            {recipe.servings}
          </span>
        </li>
        <li>
          <span className={styles.dots} data-level={difficultyLevel[recipe.difficulty]} aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span>
            <small>{t("result.recipeDifficulty")}</small>
            {t(`result.difficulty.${recipe.difficulty}`)}
          </span>
        </li>
      </ul>

      <div className={styles.block}>
        <div className={styles.blockHead}>
          <h4>{t("result.recipeIngredients")}</h4>
          <span className={styles.counter}>
            {checked.size}/{recipe.ingredients.length}
          </span>
        </div>
        <ul className={styles.ingredients}>
          {recipe.ingredients.map((ingredient, index) => {
            const done = checked.has(index);
            return (
              <li key={`${ingredient.name}-${index}`}>
                <button
                  type="button"
                  className={`${styles.ingredient} ${done ? styles.done : ""}`}
                  onClick={() => toggle(index)}
                  aria-pressed={done}
                >
                  <span className={styles.box} aria-hidden>
                    <AnimatePresence>
                      {done && (
                        <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={spring}>
                          <Check size={13} strokeWidth={3} />
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </span>
                  <span className={styles.name}>{ingredient.name}</span>
                  <span className={styles.quantity}>{ingredient.quantity}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className={styles.block}>
        <div className={styles.blockHead}>
          <h4>{t("result.recipeSteps")}</h4>
        </div>
        <ol className={styles.steps}>
          {recipe.steps.map((step, index) => (
            <motion.li
              key={`${index}-${step.slice(0, 12)}`}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-20px" }}
              transition={{ duration: 0.4, ease: easeOut, delay: Math.min(index, 6) * 0.06 }}
            >
              <span className={styles.stepNumber}>{index + 1}</span>
              <p>{step}</p>
            </motion.li>
          ))}
        </ol>
      </div>

      {recipe.tip && (
        <p className={styles.tip}>
          <Lightbulb size={16} />
          <span>
            <strong>{t("result.recipeTip")}</strong> {recipe.tip}
          </span>
        </p>
      )}
    </div>
  );
}
