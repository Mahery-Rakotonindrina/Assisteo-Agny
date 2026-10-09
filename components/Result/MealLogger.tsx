import Link from "next/link";
import { useState } from "react";
import { BookOpen, Plus, X } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { useTranslation } from "@/hooks/useTranslation";
import { mealAt, mealKinds, portionChoices, type MealKind } from "@/lib/food";
import { formatDateTime, formatNumber } from "@/lib/format";
import { haptics } from "@/services/device";
import { foodJournal } from "@/services/foodJournal";
import type { HistoryEntry } from "@/types/history";
import styles from "./Food.module.scss";

/** "I ate this": adds the scanned food to the journal, with the meal and the portions. */
export function MealLogger({ entry }: { entry: HistoryEntry }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const [meal, setMeal] = useState<MealKind>(() => mealAt(Date.now()));
  const [portions, setPortions] = useState(1);
  const calories = entry.analysis.nutrition?.calories ?? 0;
  const logs = [...(entry.meals ?? [])].sort((a, b) => b.at - a.at);

  const add = async () => {
    haptics.success();
    await foodJournal.add(entry.id, { meal, portions });
    toast(t("food.logged", { meal: t(`food.meals.${meal}`) }));
  };

  return (
    <div className={styles.logger}>
      <div className={styles.pickRow} role="group" aria-label={t("food.meal")}>
        {mealKinds.map((value) => (
          <button key={value} type="button" aria-pressed={meal === value} onClick={() => setMeal(value)}>
            {t(`food.meals.${value}`)}
          </button>
        ))}
      </div>
      <div className={styles.pickRow} role="group" aria-label={t("food.portions")}>
        {portionChoices.map((value) => (
          <button key={value} type="button" aria-pressed={portions === value} onClick={() => setPortions(value)}>
            {t("food.portionCount", { count: formatNumber(value, locale) })}
          </button>
        ))}
      </div>
      <Button icon={<Plus />} onClick={() => void add()} block>
        {t("food.logButton", { kcal: formatNumber(Math.round(calories * portions), locale) })}
      </Button>

      {logs.length > 0 && (
        <ul className={styles.logs}>
          {logs.slice(0, 5).map((log) => (
            <li key={log.id}>
              <span>
                {t(`food.meals.${log.meal}`)} · {formatDateTime(log.at, locale)} · {t("food.portionCount", { count: formatNumber(log.portions, locale) })}
              </span>
              <button type="button" onClick={() => void foodJournal.remove(entry.id, log.id)} aria-label={t("food.removeLog")}>
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Link href="/food" className={styles.journalLink}>
        <BookOpen size={15} /> {t("food.openJournal")}
      </Link>
    </div>
  );
}
