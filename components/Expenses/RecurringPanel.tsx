import { useState, type FormEvent } from "react";
import { CalendarPlus, Check, Pencil, Plus, RotateCcw, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { useExpenseLabels } from "@/hooks/useExpenseLabels";
import { useExpenseReminderTexts } from "@/hooks/useExpenseReminderTexts";
import { useTranslation } from "@/hooks/useTranslation";
import {
  byKind,
  dueReminderChoices,
  incomeKinds,
  occurrenceIn,
  paymentMethods,
  shiftMonth,
  type DueReminder,
  type ExpenseRecord,
  type PaymentMethod,
  type Recurring,
} from "@/lib/expenses";
import { formatAriary, formatDate } from "@/lib/format";
import { addToCalendar, type CalendarKind } from "@/services/calendarExport";
import { haptics } from "@/services/device";
import { expenseStore } from "@/services/expenseStore";
import { parseAmount } from "./ExpenseForm";
import styles from "./Expenses.module.scss";

type Props = { month: string; records: ExpenseRecord[]; canRemind: boolean };

/** Rent, school fees, subscriptions, a salary: what comes back every month, on its day. */
export function RecurringPanel({ month, records, canRemind }: Props) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const { categoryName } = useExpenseLabels(records);
  const texts = useExpenseReminderTexts();
  const [editing, setEditing] = useState<Partial<Recurring> | null>(null);
  const all = byKind(records, "recurring").sort((a, b) => a.day - b.day || a.createdAt - b.createdAt);
  const running = all.filter((item) => !item.endMonth || item.endMonth >= month);

  const calendar = async (recurring: Recurring, kind: CalendarKind) => {
    const start = occurrenceIn(recurring, month) ?? occurrenceIn(recurring, recurring.startMonth);
    if (start === null) return;
    // The calendar event sits on the due day itself.
    const text = texts.due({ recurring: { ...recurring, remind: "day" }, month, dueAt: start, at: start });
    const outcome = await addToCalendar(kind, { uid: `${recurring.id}@assisteo-agny`, title: text.title, details: text.body, start, repeat: "monthly" });
    if (outcome === "downloaded") toast(t("reminders.calendarDownloaded"));
  };

  if (editing) return <RecurringForm key={editing.id ?? "new"} month={month} records={records} initial={editing} canRemind={canRemind} onDone={() => setEditing(null)} />;

  return (
    <div className={styles.panel}>
      <div className={styles.row}>
        <Button icon={<Plus />} onClick={() => setEditing({ flow: "expense" })}>
          {t("expenses.recurring.add")}
        </Button>
        <Button variant="secondary" icon={<Plus />} onClick={() => setEditing({ flow: "income", category: "salary" })}>
          {t("expenses.recurring.addIncome")}
        </Button>
      </div>
      {running.length === 0 ? (
        <p className={styles.hint}>{t("expenses.recurring.empty")}</p>
      ) : (
        <ul className={styles.entries}>
          {running.map((item) => {
            const skipped = item.skipped.includes(month);
            const at = occurrenceIn(item, month);
            return (
              <li key={item.id} className={styles.entry} data-excluded={skipped || undefined}>
                <button type="button" className={styles.entryMain} onClick={() => setEditing(item)}>
                  <span className={styles.entryText}>
                    <strong>{item.label || categoryName(item.category)}</strong>
                    <small>
                      {item.flow === "income" && <span className={styles.badge}>{t("expenses.recurring.income")}</span>}
                      {[
                        t("expenses.recurring.everyMonth", { day: item.day }),
                        item.flow === "income" ? t(`expenses.incomes.${item.category}`) : categoryName(item.category),
                        at !== null && formatDate(at, locale),
                        canRemind && item.flow === "expense" && item.remind !== "none" && t(`expenses.recurring.reminds.${item.remind}`),
                        skipped && t("expenses.recurring.skipped"),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </span>
                  <span className={styles.amount}>{formatAriary(item.amountMga, locale)}</span>
                </button>
                <div className={styles.actions}>
                  <Button variant="ghost" icon={<Pencil />} onClick={() => setEditing(item)}>
                    {t("expenses.edit")}
                  </Button>
                  {at !== null && (
                    <Button variant="ghost" icon={skipped ? <RotateCcw /> : <Square />} onClick={() => void expenseStore.setSkipped(item.id, month, !skipped)}>
                      {t(skipped ? "expenses.recurring.unskip" : "expenses.recurring.skip")}
                    </Button>
                  )}
                  {item.flow === "expense" &&
                    (["google", "ics"] as const).map((kind) => (
                      <Button key={kind} variant="ghost" icon={<CalendarPlus />} onClick={() => void calendar(item, kind)}>
                        {t(kind === "google" ? "reminders.calendarGoogle" : "reminders.calendarOther")}
                      </Button>
                    ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

type FormProps = { month: string; records: ExpenseRecord[]; initial: Partial<Recurring>; canRemind: boolean; onDone: () => void };

function RecurringForm({ month, records, initial, canRemind, onDone }: FormProps) {
  const { t } = useTranslation();
  const { categories } = useExpenseLabels(records);
  const flow = initial.flow ?? "expense";
  const [label, setLabel] = useState(initial.label ?? "");
  const [amount, setAmount] = useState(initial.amountMga ? String(initial.amountMga) : "");
  const [category, setCategory] = useState(initial.category ?? (flow === "income" ? "salary" : "rent"));
  const [day, setDay] = useState(String(initial.day ?? 5));
  const [payment, setPayment] = useState<PaymentMethod | "">(initial.payment ?? "");
  const [remind, setRemind] = useState<DueReminder>(initial.remind ?? "none");
  const value = parseAmount(amount);
  const dayValue = Math.round(Number(day));
  const validDay = dayValue >= 1 && dayValue <= 31;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (value === undefined || !validDay) return;
    haptics.success();
    await expenseStore.saveRecurring({
      id: initial.id,
      flow,
      label,
      amountMga: value,
      category,
      day: dayValue,
      startMonth: initial.startMonth ?? month,
      endMonth: initial.endMonth,
      payment: flow === "expense" ? payment || undefined : undefined,
      remind: flow === "expense" ? remind : "none",
      skipped: initial.skipped ?? [],
    });
    onDone();
  };

  // Stopping keeps the past months as they were; from this month on it no longer counts.
  const stop = async () => {
    if (!initial.id) return;
    const stillCounted = initial.startMonth && initial.startMonth < month;
    if (stillCounted) await expenseStore.saveRecurring({ ...(initial as Recurring), endMonth: shiftMonth(month, -1) });
    else await expenseStore.remove(initial.id);
    onDone();
  };

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} aria-label={t(flow === "income" ? "expenses.recurring.addIncome" : "expenses.recurring.add")}>
      <div className={styles.fields}>
        <label className={styles.wide}>
          <span>{t("expenses.recurring.label")}</span>
          <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={80} placeholder={t(flow === "income" ? "expenses.recurring.incomePlaceholder" : "expenses.recurring.placeholder")} />
        </label>
        <label>
          <span>{t("expenses.form.amount")}</span>
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" placeholder="Ar" required />
        </label>
        <label>
          <span>{t("expenses.recurring.day")}</span>
          <input value={day} onChange={(event) => setDay(event.target.value)} inputMode="numeric" required />
        </label>
        <label>
          <span>{t(flow === "income" ? "expenses.income.kind" : "expenses.form.category")}</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            {flow === "income"
              ? incomeKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`expenses.incomes.${kind}`)}
                  </option>
                ))
              : categories.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
          </select>
        </label>
        {flow === "expense" && (
          <label>
            <span>{t("expenses.form.payment")}</span>
            <select value={payment} onChange={(event) => setPayment(event.target.value as PaymentMethod | "")}>
              <option value="">—</option>
              {paymentMethods.map((method) => (
                <option key={method} value={method}>
                  {t(`expenses.payments.${method}`)}
                </option>
              ))}
            </select>
          </label>
        )}
        {flow === "expense" && canRemind && (
          <label>
            <span>{t("expenses.recurring.remind")}</span>
            <select value={remind} onChange={(event) => setRemind(event.target.value as DueReminder)}>
              {dueReminderChoices.map((choice) => (
                <option key={choice} value={choice}>
                  {t(`expenses.recurring.reminds.${choice}`)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {validDay && dayValue > 28 && <p className={styles.hint}>{t("expenses.recurring.lastDayHint")}</p>}
      <div className={styles.row}>
        <Button type="submit" icon={<Check />} disabled={value === undefined || !validDay}>
          {t("expenses.save")}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t("expenses.cancel")}
        </Button>
        {initial.id && (
          <Button variant="danger" icon={<Trash2 />} onClick={() => void stop()}>
            {t("expenses.recurring.stop")}
          </Button>
        )}
      </div>
    </form>
  );
}
