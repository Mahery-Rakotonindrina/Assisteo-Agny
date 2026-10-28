import { useEffect, useState, type FormEvent } from "react";
import { CalendarOff, Check, ExternalLink, EyeOff, Pencil, Plus, RotateCcw, Trash2, Wallet } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { Toggle } from "@/components/Toggle";
import { useTranslation } from "@/hooks/useTranslation";
import { incomeKindOf, incomeKinds, keepKey, monthKey, storedIncome, type Income, type IncomeItem, type IncomeKind } from "@/lib/expenses";
import { formatAriary, formatDate } from "@/lib/format";
import { dayString } from "@/lib/papers";
import { haptics } from "@/services/device";
import { expenseStore } from "@/services/expenseStore";
import { Chips, incomeIcons } from "./CategoryChips";
import { EmptyNote } from "./EmptyNote";
import { dayOf, parseAmount, today } from "./ExpenseForm";
import { ExpenseSheet } from "./ExpenseSheet";
import styles from "./Expenses.module.scss";

/** An income being edited, or values to start from: the kind as the user picks it (help from the family included). */
type IncomeDraft = Partial<Omit<Income, "income">> & { income?: IncomeKind };

type Props = {
  month: string;
  incomes: IncomeItem[];
  defaultAt: number;
  /** A line to show first and open (from "Counted in your income →"). */
  focus?: string | null;
};

/** The month's incomes: typed in, every month (salary…), and what comes in on its own (sales, Mobile Money received). */
export function IncomePanel({ month, incomes, defaultAt, focus }: Props) {
  const { t, locale } = useTranslation();
  const [editing, setEditing] = useState<IncomeDraft | null>(null);
  const [opened, setOpened] = useState<string | null>(focus ?? null);
  const money = (value: number) => formatAriary(value, locale);

  useEffect(() => {
    if (!focus) return;
    const timer = setTimeout(() => document.querySelector(`[data-key="${CSS.escape(focus)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 300);
    return () => clearTimeout(timer);
  }, [focus]);

  const title = (item: IncomeItem) =>
    item.origin === "sale" && item.label
      ? t("expenses.income.sale", { title: item.label })
      : (item.origin === "mobile_money" || item.origin === "receipt") && item.label
        ? t("expenses.income.from", { name: item.label })
        : item.label || t(`expenses.incomes.${item.income}`);

  const detail = (item: IncomeItem) =>
    [
      formatDate(item.at, locale),
      item.origin === "manual" && item.label && t(`expenses.incomes.${item.income}`),
      item.profitMga !== undefined && t(item.profitMga < 0 ? "expenses.income.loss" : "expenses.income.profit", { amount: money(Math.abs(item.profitMga)) }),
      item.unpaidMga ? t("expenses.income.unpaid", { amount: money(item.unpaidMga) }) : null,
      item.excluded && t("expenses.excluded"),
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <div className={styles.panel}>
      <div className={styles.actionRow}>
        <Button size="lg" icon={<Plus />} onClick={() => setEditing({ at: defaultAt })}>
          {t("expenses.income.add")}
        </Button>
      </div>
      {incomes.length === 0 ? (
        <EmptyNote icon={<Wallet />} texts="expenses.income.empty" />
      ) : (
        <section aria-labelledby="income-list">
          <h2 id="income-list" className={styles.subTitle}>
            {t("expenses.income.list")}
          </h2>
          <ul className={styles.entries}>
            {incomes.map((item) => {
              const open = opened === item.key;
              const auto = item.origin !== "manual";
              return (
                <li key={item.key} data-key={item.key} className={styles.entry} data-excluded={item.excluded || undefined} data-fresh={focus === item.key || undefined}>
                  <button
                    type="button"
                    className={styles.entryMain}
                    aria-expanded={auto ? open : undefined}
                    onClick={() => (item.record ? setEditing({ ...item.record, income: item.income }) : setOpened(open ? null : item.key))}
                  >
                    <span className={styles.entryText}>
                      <strong>{title(item)}</strong>
                      <small>
                        {auto && (
                          <span className={styles.badge}>
                            {t("expenses.auto", { origin: t(`expenses.origins.${item.origin === "receipt" ? "mobile_money" : item.origin}`) })}
                          </span>
                        )}
                        {item.doubt && (
                          <span className={styles.badge} data-tone="warning">
                            {t("expenses.doubt")}
                          </span>
                        )}
                        {item.doubt ? formatDate(item.at, locale) : detail(item)}
                      </small>
                    </span>
                    <span className={styles.amount}>{money(item.amountMga)}</span>
                  </button>
                  {auto && open && (
                    <div className={styles.actions}>
                      {item.href && (
                        <Button variant="ghost" href={item.href} icon={<ExternalLink />}>
                          {t("expenses.openSource")}
                        </Button>
                      )}
                      {item.doubt ? (
                        <Button variant="ghost" icon={<Check />} onClick={() => void expenseStore.setExcluded(keepKey(item.key), true)}>
                          {t("expenses.keepAnyway")}
                        </Button>
                      ) : item.recurring ? (
                        <>
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
                        </>
                      ) : (
                        <Button variant="ghost" icon={item.excluded ? <RotateCcw /> : <EyeOff />} onClick={() => void expenseStore.setExcluded(item.key, !item.excluded)}>
                          {t(item.excluded ? "expenses.include" : "expenses.exclude")}
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <ExpenseSheet open={editing !== null} title={editing?.id ? t("expenses.edit") : t("expenses.income.add")} onClose={() => setEditing(null)}>
        {editing && <IncomeForm key={editing.id ?? editing.sourceKey ?? "new"} initial={editing} onDone={() => setEditing(null)} />}
      </ExpenseSheet>
    </div>
  );
}

function IncomeForm({ initial, onDone }: { initial: IncomeDraft; onDone: () => void }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const [amount, setAmount] = useState(initial.amountMga ? String(initial.amountMga) : "");
  const [income, setIncome] = useState<IncomeKind>(initial.income ? incomeKindOf(initial.income, initial.from) : "salary");
  const [day, setDay] = useState(() => dayString(initial.at ?? Date.now()));
  const [todayValue] = useState(today);
  const [note, setNote] = useState(initial.note ?? "");
  const [repeat, setRepeat] = useState(false);
  const value = parseAmount(amount);
  // A new income may come back every month (a recurring item, as in the Fixed tab).
  const canRepeat = !initial.id && !initial.sourceKey;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (value === undefined) return;
    haptics.success();
    const at = dayOf(day);
    // Help from the family is written as "other", named in the note (an older app knows no "family").
    const stored = storedIncome(income);
    const named = note.trim() || (stored.from ? t(`expenses.incomes.${income}`) : "");
    if (canRepeat && repeat) {
      const date = new Date(at);
      await expenseStore.saveRecurring({
        flow: "income",
        label: note.trim() || t(`expenses.incomes.${income}`),
        amountMga: value,
        category: stored.kind,
        from: stored.from,
        day: date.getDate(),
        startMonth: monthKey(at),
        remind: "none",
        skipped: [],
      });
      toast(t("expenses.saved.recurring", { amount: formatAriary(Math.round(value), locale), day: date.getDate() }));
    } else {
      await expenseStore.saveIncome({ id: initial.id, at, amountMga: value, income: stored.kind, from: stored.from, note: named, sourceKey: initial.sourceKey });
      toast(initial.id ? t("expenses.saved.changed") : t("expenses.saved.income", { amount: formatAriary(Math.round(value), locale), kind: t(`expenses.incomes.${income}`) }));
    }
    onDone();
  };

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} aria-label={t("expenses.income.add")}>
      <div className={styles.fields}>
        <label className={styles.wide}>
          <span>{t("expenses.form.amount")}</span>
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="numeric"
            placeholder={t("expenses.form.amountExample")}
            className={styles.amountInput}
            required
            autoFocus={!initial.id}
          />
        </label>
        <div className={styles.wide}>
          <Chips
            label={t("expenses.income.kind")}
            value={income}
            onChange={(id) => setIncome(id as IncomeKind)}
            options={incomeKinds.map((kind) => ({ id: kind, name: t(`expenses.incomes.${kind}`), Icon: incomeIcons[kind] }))}
          />
        </div>
        <label>
          <span>
            {t("expenses.form.date")}
            {day === todayValue && ` (${t("expenses.form.today")})`}
          </span>
          <input type="date" value={day} onChange={(event) => setDay(event.target.value)} required />
        </label>
        <label>
          <span>{t("expenses.form.note")}</span>
          <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={200} />
        </label>
        {canRepeat && (
          <div className={`${styles.wide} ${styles.switchRow}`}>
            <span>
              <strong>{t("expenses.income.repeat")}</strong>
              <small className={styles.hint}>{t("expenses.income.repeatHint")}</small>
            </span>
            <Toggle checked={repeat} onChange={setRepeat} label={t("expenses.income.repeat")} />
          </div>
        )}
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
