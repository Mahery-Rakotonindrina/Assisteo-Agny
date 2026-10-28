import { useState, type FormEvent } from "react";
import { Check, PiggyBank, Plus, SlidersHorizontal, Tag, Trash2 } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { useExpenseLabels } from "@/hooks/useExpenseLabels";
import { useTranslation } from "@/hooks/useTranslation";
import { barPercent, BUDGET_ID, customColors, customIcons, type Budget, type BudgetLine, type CustomIcon, type ExpenseRecord } from "@/lib/expenses";
import { formatAriary } from "@/lib/format";
import { haptics } from "@/services/device";
import { expenseStore } from "@/services/expenseStore";
import { categoryIcons } from "./CategoryChips";
import { EmptyNote } from "./EmptyNote";
import { parseAmount } from "./ExpenseForm";
import { ExpenseSheet } from "./ExpenseSheet";
import styles from "./Expenses.module.scss";

export { categoryIcons };

/** Where the month stands against its caps, the caps (in a sheet), and the user's own categories. */
export function BudgetPanel({ records, lines }: { records: ExpenseRecord[]; lines: BudgetLine[] }) {
  const { t, locale } = useTranslation();
  const { categoryName, categoryColor, custom } = useExpenseLabels(records);
  const budget = records.find((record): record is Budget => record.kind === "budget" && record.id === BUDGET_ID);
  const [setting, setSetting] = useState(false);
  const money = (value: number) => formatAriary(value, locale);
  const scopeName = (scope: string) => (scope === "total" ? t("expenses.budget.overall") : categoryName(scope));

  return (
    <div className={styles.panel}>
      <div className={styles.actionRow}>
        <Button size="lg" icon={<SlidersHorizontal />} onClick={() => setSetting(true)}>
          {t("expenses.budget.set")}
        </Button>
      </div>

      {lines.length === 0 ? (
        <EmptyNote icon={<PiggyBank />} texts="expenses.budget.empty" />
      ) : (
        <section aria-labelledby="budget-where">
          <h2 id="budget-where" className={styles.subTitle}>
            {t("expenses.budget.where")}
          </h2>
          <ul className={styles.bars} data-testid="budget-bars">
            {lines.map((line) => (
              <li key={line.scope}>
                <span className={styles.barLabel}>
                  <span>
                    {line.scope !== "total" && <i className={styles.dot} style={{ background: categoryColor(line.scope) }} />}
                    {scopeName(line.scope)}
                  </span>
                  <small>
                    {money(line.spent)} / {money(line.cap)}
                  </small>
                </span>
                <span className={styles.track} data-level={line.level}>
                  <span style={{ width: `${barPercent(line.ratio)}%` }} />
                </span>
                <small className={styles.barNote} data-level={line.level}>
                  {line.level === "over" ? t("expenses.budget.overBy", { amount: money(line.spent - line.cap) }) : t("expenses.budget.remaining", { amount: money(line.cap - line.spent) })}
                  {` · ${barPercent(line.ratio)} %`}
                </small>
              </li>
            ))}
          </ul>
          <p className={styles.hint}>{t("expenses.budget.hint")}</p>
        </section>
      )}

      <section className={styles.panel}>
        <div>
          <h2 className={styles.subTitle}>{t("expenses.custom.title")}</h2>
          <p className={styles.hint}>{t("expenses.custom.example")}</p>
        </div>
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

      <ExpenseSheet open={setting} title={t("expenses.budget.set")} onClose={() => setSetting(false)}>
        <BudgetForm key={budget?.updatedAt ?? 0} records={records} budget={budget} onDone={() => setSetting(false)} />
      </ExpenseSheet>
    </div>
  );
}

function BudgetForm({ records, budget, onDone }: { records: ExpenseRecord[]; budget?: Budget; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { categories } = useExpenseLabels(records);
  const [total, setTotal] = useState(budget?.total ? String(budget.total) : "");
  const [caps, setCaps] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(budget?.categories ?? {}).map(([key, value]) => [key, String(value)])));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    haptics.success();
    await expenseStore.setBudget(parseAmount(total), Object.fromEntries(Object.entries(caps).map(([key, value]) => [key, parseAmount(value)])));
    toast(t("expenses.budget.saved"));
    onDone();
  };

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} aria-label={t("expenses.budget.title")}>
      <p className={styles.hint}>{t("expenses.budget.hint")}</p>
      <div className={styles.fields}>
        <label className={styles.wide}>
          <span>{t("expenses.budget.overall")}</span>
          <input value={total} onChange={(event) => setTotal(event.target.value)} inputMode="numeric" placeholder={t("expenses.form.amountExample")} className={styles.amountInput} />
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
        <Button variant="ghost" onClick={onDone}>
          {t("expenses.cancel")}
        </Button>
      </div>
    </form>
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
