import Head from "next/head";
import Link from "next/link";
import { motion } from "motion/react";
import { useMemo, useState, type FormEvent } from "react";
import { Camera, Check, ChevronLeft, ChevronRight, Plus, Target, X } from "lucide-react";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { useToast } from "@/components/Toast";
import { useHistory } from "@/hooks/useHistory";
import { useNow } from "@/hooks/useNow";
import { useTranslation } from "@/hooks/useTranslation";
import { cleanGoals, journalDay, mealAt, mealKinds, portionChoices, sameTimeOn, totalIntake, type FoodGoals, type MealKind } from "@/lib/food";
import { formatDay, formatNumber, formatTime, startOfDay } from "@/lib/format";
import { rise, stagger } from "@/lib/motion";
import { useSettings } from "@/lib/settings/SettingsProvider";
import { haptics } from "@/services/device";
import { foodJournal } from "@/services/foodJournal";
import styles from "@/styles/Food.module.scss";

const DAY = 86_400_000;
const RADIUS = 52;

const macros = [
  { key: "proteinG", label: "result.protein", color: "var(--cat-document)" },
  { key: "carbsG", label: "result.carbs", color: "var(--cat-food)" },
  { key: "fatG", label: "result.fat", color: "var(--cat-object)" },
] as const;

/** Food journal: what was eaten each day, from the food scans, against daily goals. */
export default function FoodPage() {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const now = useNow(60_000);
  const { entries, isLoading } = useHistory();
  const { settings, update } = useSettings();
  const goals = settings.foodGoals;
  const today = startOfDay(now);
  const [picked, setPicked] = useState<number | null>(null);
  const day = picked ?? today;
  const [editingGoals, setEditingGoals] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addMeal, setAddMeal] = useState<MealKind>(() => mealAt(Date.now()));

  const items = useMemo(() => journalDay(entries, day), [entries, day]);
  const total = totalIntake(items);
  const foods = useMemo(() => entries.filter((entry) => entry.analysis.nutrition).slice(0, 12), [entries]);
  const week = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => {
        const date = day - (6 - index) * DAY;
        return { date, calories: totalIntake(journalDay(entries, date)).calories };
      }),
    [entries, day],
  );

  const dayLabel = day === today ? t("history.today") : day === today - DAY ? t("history.yesterday") : formatDay(day, locale);
  const share = Math.min(1, total.calories / goals.calories);
  const left = goals.calories - total.calories;

  const add = async (entryId: string) => {
    haptics.success();
    await foodJournal.add(entryId, { at: sameTimeOn(day), meal: addMeal });
    setAdding(false);
    toast(t("food.logged", { meal: t(`food.meals.${addMeal}`) }));
  };

  const saveGoals = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    update({ foodGoals: cleanGoals(Object.fromEntries(["calories", "proteinG", "carbsG", "fatG"].map((key) => [key, Number(data.get(key))]))) });
    setEditingGoals(false);
    toast(t("food.goalsSaved"));
  };

  return (
    <>
      <Head>
        <title>{`${t("food.title")} · ${t("meta.title")}`}</title>
      </Head>
      <motion.div className={styles.page} variants={stagger} initial="hidden" animate="show">
        <motion.header variants={rise} className={styles.header}>
          <h1>{t("food.title")}</h1>
          <p>{t("food.subtitle")}</p>
        </motion.header>

        {!isLoading && foods.length === 0 ? (
          <motion.div variants={rise}>
            <EmptyState
              title={t("food.emptyTitle")}
              body={t("food.emptyBody")}
              action={
                <Button href="/?mode=food" icon={<Camera />}>
                  {t("food.scanMeal")}
                </Button>
              }
            />
          </motion.div>
        ) : (
          <>
            <motion.div variants={rise} className={styles.dayNav}>
              <button type="button" onClick={() => setPicked(day - DAY)} aria-label={t("food.previousDay")}>
                <ChevronLeft size={20} />
              </button>
              <strong>{dayLabel}</strong>
              <button type="button" onClick={() => setPicked(day + DAY >= today ? null : day + DAY)} disabled={day >= today} aria-label={t("food.nextDay")}>
                <ChevronRight size={20} />
              </button>
            </motion.div>

            <motion.section variants={rise} className={styles.summary}>
              <div className={styles.ring}>
                <svg viewBox="0 0 120 120" aria-hidden>
                  <circle cx="60" cy="60" r={RADIUS} className={styles.ringTrack} />
                  <circle
                    cx="60"
                    cy="60"
                    r={RADIUS}
                    className={styles.ringValue}
                    data-over={left < 0 || undefined}
                    strokeDasharray={`${2 * Math.PI * RADIUS * share} ${2 * Math.PI * RADIUS}`}
                  />
                </svg>
                <span>
                  <strong>{formatNumber(Math.round(total.calories), locale)}</strong>
                  <small>{t("food.ofGoal", { goal: formatNumber(goals.calories, locale) })}</small>
                </span>
              </div>
              <div className={styles.macros}>
                <p className={styles.left} data-over={left < 0 || undefined}>
                  {left >= 0
                    ? t("food.kcalLeft", { count: formatNumber(Math.round(left), locale) })
                    : t("food.kcalOver", { count: formatNumber(Math.round(-left), locale) })}
                </p>
                {macros.map((macro) => (
                  <div key={macro.key} className={styles.macro}>
                    <span>
                      {t(macro.label)}
                      <small>
                        {formatNumber(Math.round(total[macro.key]), locale)} / {formatNumber(goals[macro.key], locale)} g
                      </small>
                    </span>
                    <span className={styles.bar}>
                      <span style={{ width: `${Math.min(100, (total[macro.key] / goals[macro.key]) * 100)}%`, background: macro.color }} />
                    </span>
                  </div>
                ))}
                <button type="button" className={styles.goalsButton} onClick={() => setEditingGoals((value) => !value)}>
                  <Target size={14} /> {t("food.goals")}
                </button>
              </div>
            </motion.section>

            {editingGoals && (
              <motion.form variants={rise} initial="hidden" animate="show" className={styles.goalsForm} onSubmit={saveGoals}>
                <GoalInput name="calories" label={t("food.goalCalories")} value={goals.calories} unit={t("result.kcal")} />
                <GoalInput name="proteinG" label={t("result.protein")} value={goals.proteinG} unit="g" />
                <GoalInput name="carbsG" label={t("result.carbs")} value={goals.carbsG} unit="g" />
                <GoalInput name="fatG" label={t("result.fat")} value={goals.fatG} unit="g" />
                <p>{t("food.goalsHint")}</p>
                <Button type="submit" size="md" icon={<Check />}>
                  {t("lists.save")}
                </Button>
              </motion.form>
            )}

            <motion.div variants={rise} className={styles.meals}>
              {mealKinds.map((meal) => {
                const ofMeal = items.filter((item) => item.log.meal === meal);
                if (ofMeal.length === 0) return null;
                const kcal = totalIntake(ofMeal).calories;
                return (
                  <section key={meal} className={styles.meal}>
                    <h2>
                      {t(`food.meals.${meal}`)}
                      <small>{t("food.kcal", { count: formatNumber(Math.round(kcal), locale) })}</small>
                    </h2>
                    <ul>
                      {ofMeal.map(({ entry, log, intake }) => (
                        <li key={log.id}>
                          {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
                          <img src={entry.thumbnail} alt="" />
                          <Link href={{ pathname: "/result", query: { id: entry.id } }} className={styles.mealText}>
                            <strong>{entry.analysis.title}</strong>
                            <small>
                              {formatTime(log.at, locale)} · {t("food.kcal", { count: formatNumber(Math.round(intake.calories), locale) })}
                            </small>
                          </Link>
                          <select
                            value={log.portions}
                            onChange={(event) => void foodJournal.edit(entry.id, log.id, { portions: Number(event.target.value) })}
                            aria-label={t("food.portions")}
                          >
                            {[...new Set([...portionChoices, log.portions])].map((value) => (
                              <option key={value} value={value}>
                                {t("food.portionCount", { count: formatNumber(value, locale) })}
                              </option>
                            ))}
                          </select>
                          <button type="button" className={styles.remove} onClick={() => void foodJournal.remove(entry.id, log.id)} aria-label={t("food.removeLog")}>
                            <X size={15} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
              {items.length === 0 && <p className={styles.nothing}>{t("food.nothingYet")}</p>}
            </motion.div>

            <motion.div variants={rise} className={styles.addRow}>
              <Button href="/?mode=food" icon={<Camera />}>
                {t("food.scanMeal")}
              </Button>
              <Button variant="secondary" icon={<Plus />} onClick={() => setAdding((value) => !value)} aria-expanded={adding}>
                {t("food.fromScans")}
              </Button>
            </motion.div>

            {adding && (
              <motion.section variants={rise} initial="hidden" animate="show" className={styles.picker}>
                <div className={styles.mealChips} role="group" aria-label={t("food.meal")}>
                  {mealKinds.map((meal) => (
                    <button key={meal} type="button" aria-pressed={addMeal === meal} onClick={() => setAddMeal(meal)}>
                      {t(`food.meals.${meal}`)}
                    </button>
                  ))}
                </div>
                <ul>
                  {foods.map((entry) => (
                    <li key={entry.id}>
                      <button type="button" onClick={() => void add(entry.id)}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
                        <img src={entry.thumbnail} alt="" />
                        <span>
                          <strong>{entry.analysis.title}</strong>
                          <small>
                            {entry.analysis.nutrition!.portion} · {t("food.kcal", { count: formatNumber(entry.analysis.nutrition!.calories, locale) })}
                          </small>
                        </span>
                        <Plus size={18} />
                      </button>
                    </li>
                  ))}
                </ul>
              </motion.section>
            )}

            <motion.section variants={rise} className={styles.week}>
              <h2>{t("food.week")}</h2>
              <div className={styles.chart}>
                {week.map(({ date, calories }) => (
                  <button
                    key={date}
                    type="button"
                    onClick={() => setPicked(date >= today ? null : date)}
                    aria-pressed={date === day}
                    aria-label={`${formatDay(date, locale)} · ${t("food.kcal", { count: formatNumber(Math.round(calories), locale) })}`}
                  >
                    <span className={styles.column}>
                      <span style={{ height: `${Math.min(100, (calories / goals.calories) * 100)}%` }} data-over={calories > goals.calories || undefined} />
                    </span>
                    <small>{new Date(date).toLocaleDateString(locale, { weekday: "narrow" })}</small>
                  </button>
                ))}
              </div>
              <p className={styles.estimate}>{t("food.estimateNote")}</p>
            </motion.section>
          </>
        )}
      </motion.div>
    </>
  );
}

function GoalInput({ name, label, value, unit }: { name: keyof FoodGoals; label: string; value: number; unit: string }) {
  return (
    <label className={styles.goal}>
      <span>{label}</span>
      <span className={styles.goalField}>
        <input name={name} type="number" inputMode="numeric" min={1} max={20000} defaultValue={value} />
        <small>{unit}</small>
      </span>
    </label>
  );
}
