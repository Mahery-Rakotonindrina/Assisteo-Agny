import { useState, type FormEvent } from "react";
import { Baby, Check, Church, Gift, Heart, Home, Plane, Plus, Star, Tag, Trash2, type LucideIcon } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { useExpenseLabels } from "@/hooks/useExpenseLabels";
import { useTranslation } from "@/hooks/useTranslation";
import { BUDGET_ID, customColors, customIcons, type Budget, type CustomIcon, type ExpenseRecord } from "@/lib/expenses";
import { haptics } from "@/services/device";
import { expenseStore } from "@/services/expenseStore";
import { parseAmount } from "./ExpenseForm";
import styles from "./Expenses.module.scss";

export const categoryIcons: Record<CustomIcon, LucideIcon> = { tag: Tag, heart: Heart, home: Home, gift: Gift, star: Star, baby: Baby, church: Church, plane: Plane };

/** The monthly caps (overall and per category), and the user's own categories. */
export function BudgetPanel({ records }: { records: ExpenseRecord[] }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { categories, custom } = useExpenseLabels(records);
  const budget = records.find((record): record is Budget => record.kind === "budget" && record.id === BUDGET_ID);
  const [total, setTotal] = useState(budget?.total ? String(budget.total) : "");
  const [caps, setCaps] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(budget?.categories ?? {}).map(([key, value]) => [key, String(value)])));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    haptics.success();
    await expenseStore.setBudget(parseAmount(total), Object.fromEntries(Object.entries(caps).map(([key, value]) => [key, parseAmount(value)])));
    toast(t("expenses.budget.saved"));
  };

  return (
    <div className={styles.panel}>
      <form className={styles.form} onSubmit={(event) => void submit(event)} aria-label={t("expenses.budget.title")}>
        <p className={styles.hint}>{t("expenses.budget.hint")}</p>
        <div className={styles.fields}>
          <label className={styles.wide}>
            <span>{t("expenses.budget.overall")}</span>
            <input value={total} onChange={(event) => setTotal(event.target.value)} inputMode="numeric" placeholder="Ar" />
          </label>
          {categories.map((category) => (
            <label key={category.id}>
              <span>{category.name}</span>
              <input value={caps[category.id] ?? ""} onChange={(event) => setCaps({ ...caps, [category.id]: event.target.value })} inputMode="numeric" placeholder="Ar" />
            </label>
          ))}
        </div>
        <div className={styles.row}>
          <Button type="submit" icon={<Check />}>
            {t("expenses.save")}
          </Button>
        </div>
      </form>

      <section className={styles.panel}>
        <h2 className={styles.subTitle}>{t("expenses.custom.title")}</h2>
        {custom.length > 0 && (
          <ul className={styles.entries}>
            {custom.map((category) => {
              const Icon = categoryIcons[category.icon] ?? Tag;
              return (
                <li key={category.id} className={styles.entry}>
                  <span className={styles.entryMain}>
                    <Icon size={18} style={{ color: category.color }} aria-hidden />
                    <span className={styles.entryText}>
                      <strong>{category.name}</strong>
                    </span>
                    <Button variant="ghost" icon={<Trash2 />} onClick={() => void expenseStore.remove(category.id)} aria-label={t("expenses.remove")}>
                      {t("expenses.remove")}
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <CategoryForm />
      </section>
    </div>
  );
}

function CategoryForm() {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [color, setColor] = useState(customColors[0]);
  const [icon, setIcon] = useState<CustomIcon>("tag");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    await expenseStore.saveCategory({ name, color, icon });
    setName("");
  };

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} aria-label={t("expenses.custom.add")}>
      <div className={styles.fields}>
        <label className={styles.wide}>
          <span>{t("expenses.custom.name")}</span>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} placeholder={t("expenses.custom.placeholder")} />
        </label>
      </div>
      <div className={styles.swatches} role="group" aria-label={t("expenses.custom.color")}>
        {customColors.map((swatch) => (
          <button key={swatch} type="button" aria-pressed={color === swatch} aria-label={swatch} style={{ background: swatch }} onClick={() => setColor(swatch)} />
        ))}
      </div>
      <div className={styles.swatches} role="group" aria-label={t("expenses.custom.icon")}>
        {customIcons.map((key) => {
          const Icon = categoryIcons[key];
          return (
            <button key={key} type="button" aria-pressed={icon === key} aria-label={key} onClick={() => setIcon(key)}>
              <Icon size={17} />
            </button>
          );
        })}
      </div>
      <div className={styles.row}>
        <Button type="submit" variant="secondary" icon={<Plus />} disabled={!name.trim()}>
          {t("expenses.custom.add")}
        </Button>
      </div>
    </form>
  );
}
