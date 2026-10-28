import Link from "next/link";
import { useState } from "react";
import { ArrowLeftRight, Check, EyeOff, Pencil, Receipt, RotateCcw } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { useExpenses } from "@/hooks/useExpenses";
import { useExpenseSources } from "@/hooks/useExpenseSources";
import { useHousehold, useHouseholdExpenses } from "@/hooks/useHousehold";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { receiptDraft, receiptDuplicate } from "@/lib/expenseAi";
import { byKind, keepKey, monthExpenses, monthIncomes, monthKey, receiptKey } from "@/lib/expenses";
import { isMine } from "@/lib/household";
import { formatAriary } from "@/lib/format";
import { haptics } from "@/services/device";
import { expenseStore } from "@/services/expenseStore";
import type { HistoryEntry } from "@/types/history";
import { ExpenseForm } from "./ExpenseForm";
import styles from "./Expenses.module.scss";

/**
 * Under a scanned till receipt or Mobile Money confirmation. It counts in
 * "Mes dépenses" on its own (money received: in the incomes): "Counted ·
 * See", "Don't count", or "Correct" to type it in. One in yuan, dollars or
 * euros (no rate on hand) keeps the "Add to my expenses" form. The same
 * transaction is never counted twice. Hidden without "Mes dépenses".
 */
export function ReceiptControls({ entry }: { entry: HistoryEntry }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const { has } = usePlan();
  const { records, isLoading } = useExpenses();
  const sources = useExpenseSources();
  const snapshot = useHousehold();
  const { expenses: shared, isLoading: sharedLoading } = useHouseholdExpenses();
  const [open, setOpen] = useState(false);

  const draft = receiptDraft(entry);
  if (!has("expenses") || !draft) return null;
  // Under its section title: never an empty section while the expenses load.
  if (isLoading || sharedLoading) return <p className={styles.hint}>{t("expenses.receipt.loading")}</p>;

  const share = snapshot?.household ? { name: snapshot.household.name, me: snapshot.userId, choose: true } : null;
  if (open)
    return (
      <ExpenseForm
        records={records}
        initial={draft}
        links={[]}
        share={share}
        onSaved={() => toast(t("expenses.receipt.saved"))}
        onDone={() => setOpen(false)}
      />
    );

  // The same transaction typed in already, personal or moved to the household.
  const mineShared = shared.filter((expense) => isMine(expense, snapshot?.userId ?? null));
  const duplicate = receiptDuplicate([...records, ...mineShared], entry);
  if (duplicate) {
    const sharedDuplicate = mineShared.some((expense) => expense.id === duplicate.id);
    return (
      <p className={styles.receiptStatus}>
        <Receipt size={15} />
        <span>
          {t("expenses.receipt.already", { amount: formatAriary(duplicate.amountMga, locale) })}{" "}
          <Link href={{ pathname: "/expenses", query: sharedDuplicate ? { view: "household" } : { open: duplicate.id } }}>{t("expenses.receipt.open")}</Link>
        </span>
      </p>
    );
  }

  // Counted on its own: the receipt itself, or the bill it pays.
  const key = receiptKey(entry.id);
  const billKey = `bill:${entry.id}`;
  const source = sources.find((item) => item.key === key) ?? sources.find((item) => item.key === billKey);
  // Money received, or moved between own accounts, in another currency: nothing to add as an expense.
  if (!source && (entry.analysis.document?.receipt?.direction === "in" || entry.analysis.document?.receipt?.direction === "own")) return null;
  if (!source)
    return (
      <div className={styles.row}>
        <Button
          icon={<Receipt />}
          onClick={() => {
            haptics.tap();
            setOpen(true);
          }}
        >
          {t("expenses.receipt.add")}
        </Button>
      </div>
    );

  // The same transaction scanned before: only that first scan counts.
  const first = source.sameAs ? sources.find((item) => item.key === source.sameAs) : undefined;
  if (first)
    return (
      <p className={styles.receiptStatus} data-testid="receipt-status">
        <Receipt size={15} />
        <span>
          {t("expenses.receipt.alreadyCounted")} ·{" "}
          <Link href={{ pathname: "/expenses", query: { month: monthKey(first.at), tab: first.flow === "income" ? "income" : "month", focus: first.key } }}>{t("expenses.receipt.view")}</Link>
        </span>
      </p>
    );

  const month = monthKey(source.at);
  // A withdrawal, a deposit, a transfer to oneself: not counted, its fees only, unless the user says it is an expense.
  const fees = sources.find((item) => item.feesOf === key);
  const feesHref = fees && { pathname: "/expenses", query: { month: monthKey(fees.at), tab: "month", focus: fees.key } };
  const feesNote = fees && feesHref && (
    <p className={styles.receiptStatus}>
      <Receipt size={15} />
      <span>
        {t("expenses.receipt.feesCounted", { amount: formatAriary(fees.amountMga, locale) })} · <Link href={feesHref}>{t("expenses.receipt.view")}</Link>
      </span>
    </p>
  );
  const kept = byKind(records, "exclusion").some((record) => record.sourceKey === keepKey(key));
  if (source.own && !kept)
    return (
      <div className={styles.panel}>
        <p className={styles.receiptStatus} data-testid="receipt-status">
          <ArrowLeftRight size={15} />
          <span>{t("expenses.receipt.own")}</span>
        </p>
        {feesNote}
        <div className={styles.row}>
          <Button variant="secondary" icon={<Check />} onClick={() => void expenseStore.setExcluded(keepKey(key), true)}>
            {t("expenses.receipt.isExpense")}
          </Button>
        </div>
      </div>
    );
  const incoming = source.flow === "income";
  const line = incoming ? monthIncomes(records, month, sources).find((item) => item.key === source.key) : monthExpenses(records, sources, month).find((item) => item.key === source.key);
  const doubt = Boolean(line?.doubt);
  const excluded = Boolean(line?.excluded) && !doubt;
  const href = { pathname: "/expenses", query: { month, tab: incoming ? "income" : "month", focus: source.key } };

  return (
    <div className={styles.panel}>
      <p className={styles.receiptStatus} data-testid="receipt-status">
        <Receipt size={15} />
        <span>
          {doubt ? t("expenses.receipt.doubt") : excluded ? t("expenses.receipt.notCounted") : t(incoming ? "expenses.receipt.countedIncome" : "expenses.receipt.counted")}
          {" · "}
          <Link href={href}>{t("expenses.receipt.view")}</Link>
        </span>
      </p>
      <div className={styles.row}>
        {doubt ? (
          <Button variant="secondary" icon={<Check />} onClick={() => void expenseStore.setExcluded(keepKey(source.key), true)}>
            {t("expenses.keepAnyway")}
          </Button>
        ) : (
          <Button variant="secondary" icon={excluded ? <RotateCcw /> : <EyeOff />} onClick={() => void expenseStore.setExcluded(source.key, !excluded)}>
            {t(excluded ? "expenses.include" : "expenses.exclude")}
          </Button>
        )}
        {source.own && (
          <Button variant="ghost" icon={<ArrowLeftRight />} onClick={() => void expenseStore.setExcluded(keepKey(key), false)}>
            {t("expenses.receipt.isOwn")}
          </Button>
        )}
        {!incoming && source.key === key && (
          <Button
            variant="ghost"
            icon={<Pencil />}
            onClick={() => {
              haptics.tap();
              setOpen(true);
            }}
          >
            {t("expenses.receipt.correct")}
          </Button>
        )}
      </div>
    </div>
  );
}
