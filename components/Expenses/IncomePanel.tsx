import { useState, type FormEvent } from "react";
import { CalendarOff, Check, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/Button";
import { useTranslation } from "@/hooks/useTranslation";
import { incomeKinds, type Income, type IncomeItem, type IncomeKind } from "@/lib/expenses";
import { formatAriary, formatDate } from "@/lib/format";
import { dayString } from "@/lib/papers";
import { haptics } from "@/services/device";
import { expenseStore } from "@/services/expenseStore";
import { dayOf, parseAmount } from "./ExpenseForm";
import styles from "./Expenses.module.scss";

type Props = { month: string; incomes: IncomeItem[]; spent: number; defaultAt: number };

/** The month's incomes (salary, sales…) and what is left once the expenses are paid. */
export function IncomePanel({ month, incomes, spent, defaultAt }: Props) {
  const { t, locale } = useTranslation();
  const [editing, setEditing] = useState<Partial<Income> | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const earned = incomes.reduce((total, item) => total + item.amountMga, 0);
  const money = (value: number) => formatAriary(value, locale);

  if (editing) return <IncomeForm key={editing.id ?? editing.sourceKey ?? "new"} initial={editing} onDone={() => setEditing(null)} />;

  return (
    <div className={styles.panel}>
      <div className={styles.stats}>
        <span>
          <small>{t("expenses.income.total")}</small>
          <strong>{money(earned)}</strong>
        </span>
        <span>
          <small>{t("expenses.month.spent")}</small>
          <strong>{money(spent)}</strong>
        </span>
        <span>
          <small>{t("expenses.income.left")}</small>
          <strong data-tone={earned - spent < 0 ? "bad" : undefined} data-testid="expenses-left">
            {money(earned - spent)}
          </strong>
        </span>
      </div>
      <div className={styles.row}>
        <Button icon={<Plus />} onClick={() => setEditing({ at: defaultAt })}>
          {t("expenses.income.add")}
        </Button>
      </div>
      {incomes.length === 0 ? (
        <p className={styles.hint}>{t("expenses.income.empty")}</p>
      ) : (
        <ul className={styles.entries}>
          {incomes.map((item) => {
            const open = opened === item.key;
            return (
              <li key={item.key} className={styles.entry}>
                <button
                  type="button"
                  className={styles.entryMain}
                  aria-expanded={item.recurring ? open : undefined}
                  onClick={() => (item.record ? setEditing(item.record) : setOpened(open ? null : item.key))}
                >
                  <span className={styles.entryText}>
                    <strong>{item.label || t(`expenses.incomes.${item.income}`)}</strong>
                    <small>
                      {item.recurring && <span className={styles.badge}>{t("expenses.origins.recurring")}</span>}
                      {[formatDate(item.at, locale), item.label && t(`expenses.incomes.${item.income}`)].filter(Boolean).join(" · ")}
                    </small>
                  </span>
                  <span className={styles.amount}>{money(item.amountMga)}</span>
                </button>
                {item.recurring && open && (
                  <div className={styles.actions}>
                    <Button
                      variant="ghost"
                      icon={<Pencil />}
                      onClick={() => setEditing({ at: item.at, amountMga: item.amountMga, income: item.income, note: item.label, sourceKey: item.key })}
                    >
                      {t("expenses.correct")}
                    </Button>
                    <Button variant="ghost" icon={<CalendarOff />} onClick={() => void expenseStore.setSkipped(item.recurring!.id, month, true)}>
                      {t("expenses.recurring.skip")}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className={styles.hint}>{t("expenses.income.recurringHint")}</p>
    </div>
  );
}

function IncomeForm({ initial, onDone }: { initial: Partial<Income>; onDone: () => void }) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState(initial.amountMga ? String(initial.amountMga) : "");
  const [income, setIncome] = useState<IncomeKind>(initial.income ?? "salary");
  const [day, setDay] = useState(() => dayString(initial.at ?? Date.now()));
  const [note, setNote] = useState(initial.note ?? "");
  const value = parseAmount(amount);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (value === undefined) return;
    haptics.success();
    await expenseStore.saveIncome({ id: initial.id, at: dayOf(day), amountMga: value, income, note, sourceKey: initial.sourceKey });
    onDone();
  };

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} aria-label={t("expenses.income.add")}>
      <div className={styles.fields}>
        <label>
          <span>{t("expenses.form.amount")}</span>
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" placeholder="Ar" required autoFocus={!initial.id} />
        </label>
        <label>
          <span>{t("expenses.income.kind")}</span>
          <select value={income} onChange={(event) => setIncome(event.target.value as IncomeKind)}>
            {incomeKinds.map((kind) => (
              <option key={kind} value={kind}>
                {t(`expenses.incomes.${kind}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t("expenses.form.date")}</span>
          <input type="date" value={day} onChange={(event) => setDay(event.target.value)} required />
        </label>
        <label className={styles.wide}>
          <span>{t("expenses.form.note")}</span>
          <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={200} />
        </label>
      </div>
      <div className={styles.row}>
        <Button type="submit" icon={<Check />} disabled={value === undefined}>
          {t("expenses.save")}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t("expenses.cancel")}
        </Button>
        {initial.id && (
          <Button
            variant="danger"
            icon={<Trash2 />}
            onClick={() => {
              void expenseStore.remove(initial.id!).then(onDone);
            }}
          >
            {t("expenses.remove")}
          </Button>
        )}
      </div>
    </form>
  );
}
