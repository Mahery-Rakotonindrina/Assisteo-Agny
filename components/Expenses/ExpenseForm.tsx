import { useEffect, useState, type FormEvent } from "react";
import { Check, Trash2, User, Users } from "lucide-react";
import { Button } from "@/components/Button";
import { SegmentedControl } from "@/components/SegmentedControl";
import { useExpenseLabels } from "@/hooks/useExpenseLabels";
import { useTranslation } from "@/hooks/useTranslation";
import { expenseCurrencies, paymentMethods, toAriary, type ExpenseCurrency, type ExpenseRecord, type ManualExpense, type PaymentMethod } from "@/lib/expenses";
import { formatAriary } from "@/lib/format";
import { parseNumber, type ForeignCurrency } from "@/lib/money";
import { dayString, parseDay } from "@/lib/papers";
import { haptics } from "@/services/device";
import { expenseStore } from "@/services/expenseStore";
import { marketRate } from "@/services/fx";
import { householdExpenseStore, saveExpenseIn, type ExpenseScope } from "@/services/householdExpenseStore";
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

/** The household an expense can be shared with: its name, the user, and whether they may choose. */
export type ShareChoice = { name: string; me: string | null; choose: boolean };

type Props = {
  records: ExpenseRecord[];
  /** An expense to edit (with its id), or values to start from (a line being corrected). */
  initial?: Partial<ManualExpense>;
  /** The computed lines of the month this expense can stand for. */
  links: LinkChoice[];
  onDone: () => void;
  /** Called with the expense once saved (before onDone). */
  onSaved?: (expense: Partial<ManualExpense>) => void;
  /** Where the expense being edited lives (personal by default). */
  from?: ExpenseScope;
  /** Where a new expense goes, unless the user picks the other. */
  scope?: ExpenseScope;
  /** The household, when the user is a member. */
  share?: ShareChoice | null;
};

/** Adds or edits an expense: amount (in ariary or another currency), category, day, payment, note. */
export function ExpenseForm({ records, initial, links, onDone, onSaved, from = "personal", scope: startScope, share }: Props) {
  const { t, locale } = useTranslation();
  const { categories: allCategories } = useExpenseLabels(records);
  const origin: ExpenseScope | null = initial?.id ? from : null;
  const [scope, setScope] = useState<ExpenseScope>(origin ?? startScope ?? "personal");
  const shared = scope === "household";
  // Shared expenses use the built-in categories: the members don't see each other's own ones.
  const categories = shared ? allCategories.filter((item) => !item.custom) : allCategories;
  const [currency, setCurrency] = useState<ExpenseCurrency>(initial?.currency ?? "MGA");
  const [amount, setAmount] = useState(() => String(initial?.originalAmount ?? initial?.amountMga ?? ""));
  const [rate, setRate] = useState(() => (initial?.rate ? String(initial.rate) : ""));
  const [category, setCategory] = useState(initial?.category ?? "market");
  const [day, setDay] = useState(() => (initial?.at ? dayString(initial.at) : today()));
  const [payment, setPayment] = useState<PaymentMethod | "">(initial?.payment ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [sourceKey, setSourceKey] = useState(initial?.sourceKey ?? "");
  const foreign = currency !== "MGA";
  // A line standing for a bill or a recurring item stays personal.
  const canChoose = Boolean(share?.choose) && !sourceKey;
  const pickScope = (value: ExpenseScope) => {
    setScope(value);
    if (value === "household" && allCategories.find((item) => item.id === category)?.custom) setCategory("other");
  };

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
    const saved = await saveExpenseIn(
      scope,
      origin,
      {
        id: initial?.id,
        createdAt: initial?.createdAt,
        at: dayOf(day),
        amountMga,
        category,
        note,
        payment: payment || undefined,
        sourceKey: shared ? undefined : sourceKey || undefined,
        // Kept from a scanned receipt (no duplicates).
        reference: initial?.reference,
        scanId: initial?.scanId,
        ...(foreign && { currency: currency as ForeignCurrency, originalAmount: typed, rate: rateValue }),
      },
      share?.me ?? null,
    );
    if (saved) onSaved?.(saved);
    onDone();
  };

  const remove = async () => {
    if (!initial?.id) return;
    await (from === "household" ? householdExpenseStore.remove(initial.id) : expenseStore.remove(initial.id));
    onDone();
  };

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} aria-label={t("expenses.form.title")}>
      {canChoose && share && (
        <div className={styles.scope}>
          <SegmentedControl
            ariaLabel={t("expenses.form.scope")}
            value={scope}
            onChange={pickScope}
            options={[
              { value: "personal", label: t("expenses.form.personal"), icon: <User /> },
              { value: "household", label: t("expenses.form.shared"), icon: <Users /> },
            ]}
          />
          <small className={styles.hint}>{t(shared ? "expenses.form.sharedHint" : "expenses.form.personalHint", { name: share.name })}</small>
        </div>
      )}
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
        {!shared && (links.length > 0 || sourceKey) && (
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
