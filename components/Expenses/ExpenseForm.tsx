import { useEffect, useState, type FormEvent } from "react";
import { Check, Trash2 } from "lucide-react";
import { Button } from "@/components/Button";
import { useExpenseLabels } from "@/hooks/useExpenseLabels";
import { useTranslation } from "@/hooks/useTranslation";
import { expenseCurrencies, paymentMethods, toAriary, type ExpenseCurrency, type ExpenseRecord, type ManualExpense, type PaymentMethod } from "@/lib/expenses";
import { formatAriary } from "@/lib/format";
import { parseNumber, type ForeignCurrency } from "@/lib/money";
import { dayString, parseDay } from "@/lib/papers";
import { haptics } from "@/services/device";
import { expenseStore } from "@/services/expenseStore";
import { marketRate } from "@/services/fx";
import styles from "./Expenses.module.scss";

/** A number typed in a field ("12 500", "12,5"), or none. */
export const parseAmount = (value: string) => {
  const number = parseNumber(value);
  return number !== null && number > 0 ? number : undefined;
};

// Taken in event handlers and initial state (never during render).
export const today = () => dayString(Date.now());
export const dayOf = (value: string) => parseDay(value) ?? Date.now();

export type LinkChoice = { key: string; label: string };

type Props = {
  records: ExpenseRecord[];
  /** An expense to edit (with its id), or values to start from (a line being corrected). */
  initial?: Partial<ManualExpense>;
  /** The computed lines of the month this expense can stand for. */
  links: LinkChoice[];
  onDone: () => void;
};

/** Adds or edits an expense: amount (in ariary or another currency), category, day, payment, note. */
export function ExpenseForm({ records, initial, links, onDone }: Props) {
  const { t, locale } = useTranslation();
  const { categories } = useExpenseLabels(records);
  const [currency, setCurrency] = useState<ExpenseCurrency>(initial?.currency ?? "MGA");
  const [amount, setAmount] = useState(() => String(initial?.originalAmount ?? initial?.amountMga ?? ""));
  const [rate, setRate] = useState(() => (initial?.rate ? String(initial.rate) : ""));
  const [category, setCategory] = useState(initial?.category ?? "market");
  const [day, setDay] = useState(() => (initial?.at ? dayString(initial.at) : today()));
  const [payment, setPayment] = useState<PaymentMethod | "">(initial?.payment ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [sourceKey, setSourceKey] = useState(initial?.sourceKey ?? "");
  const foreign = currency !== "MGA";

  // Today's rate, once a foreign currency is picked (the user can change it).
  useEffect(() => {
    if (!foreign || rate) return;
    let cancelled = false;
    void marketRate(currency as ForeignCurrency).then((result) => {
      if (!cancelled && result) setRate(String(Math.round(result.rate * 100) / 100));
    });
    return () => {
      cancelled = true;
    };
  }, [currency, foreign, rate]);

  const typed = parseAmount(amount);
  const rateValue = parseAmount(rate);
  const amountMga = typed === undefined ? undefined : foreign ? (rateValue ? toAriary(typed, rateValue) : undefined) : Math.round(typed);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (amountMga === undefined) return;
    haptics.success();
    await expenseStore.saveExpense({
      id: initial?.id,
      at: dayOf(day),
      amountMga,
      category,
      note,
      payment: payment || undefined,
      sourceKey: sourceKey || undefined,
      ...(foreign && { currency: currency as ForeignCurrency, originalAmount: typed, rate: rateValue }),
    });
    onDone();
  };

  const remove = async () => {
    if (!initial?.id) return;
    await expenseStore.remove(initial.id);
    onDone();
  };

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} aria-label={t("expenses.form.title")}>
      <div className={styles.fields}>
        <label>
          <span>{t("expenses.form.amount")}</span>
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" required autoFocus={!initial?.id} />
        </label>
        <label>
          <span>{t("expenses.form.currency")}</span>
          <select
            value={currency}
            onChange={(event) => {
              setCurrency(event.target.value as ExpenseCurrency);
              setRate("");
            }}
          >
            {expenseCurrencies.map((code) => (
              <option key={code} value={code}>
                {code === "MGA" ? "Ar" : code}
              </option>
            ))}
          </select>
        </label>
        {foreign && (
          <label>
            <span>{t("expenses.form.rate", { currency })}</span>
            <input value={rate} onChange={(event) => setRate(event.target.value)} inputMode="decimal" required />
          </label>
        )}
        <label>
          <span>{t("expenses.form.category")}</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            {categories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t("expenses.form.date")}</span>
          <input type="date" value={day} onChange={(event) => setDay(event.target.value)} required />
        </label>
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
        <label className={styles.wide}>
          <span>{t("expenses.form.note")}</span>
          <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={200} />
        </label>
        {(links.length > 0 || sourceKey) && (
          <label className={styles.wide}>
            <span>{t("expenses.form.link")}</span>
            <select value={sourceKey} onChange={(event) => setSourceKey(event.target.value)}>
              <option value="">{t("expenses.form.noLink")}</option>
              {sourceKey && !links.some((link) => link.key === sourceKey) && <option value={sourceKey}>{t("expenses.form.linked")}</option>}
              {links.map((link) => (
                <option key={link.key} value={link.key}>
                  {link.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {foreign && amountMga !== undefined && (
        <p className={styles.converted}>
          {t("expenses.form.converted")} <strong>{formatAriary(amountMga, locale)}</strong>
        </p>
      )}
      <div className={styles.row}>
        <Button type="submit" icon={<Check />} disabled={amountMga === undefined}>
          {t("expenses.save")}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t("expenses.cancel")}
        </Button>
        {initial?.id && (
          <Button variant="danger" icon={<Trash2 />} onClick={() => void remove()}>
            {t("expenses.remove")}
          </Button>
        )}
      </div>
    </form>
  );
}
