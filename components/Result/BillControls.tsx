import Link from "next/link";
import { CircleCheck, Receipt, Undo2 } from "lucide-react";
import { Button } from "@/components/Button";
import { useNow } from "@/hooks/useNow";
import { useTranslation } from "@/hooks/useTranslation";
import { billOf } from "@/lib/bills";
import { paperKind } from "@/lib/papers";
import { formatAriary, formatDate } from "@/lib/format";
import { parseNumber } from "@/lib/money";
import { haptics } from "@/services/device";
import { historyStore } from "@/services/historyStore";
import type { HistoryEntry } from "@/types/history";
import styles from "./Papers.module.scss";

// Taken in event handlers (never during render).
const timestamp = () => Date.now();

/** A bill under a document: its amount in ariary, paid or not, followed in "Mes factures". */
export function BillControls({ entry }: { entry: HistoryEntry }) {
  const { t, locale } = useTranslation();
  const now = useNow(60_000);
  const bill = billOf(entry, now);
  const setExpense = (patch: NonNullable<HistoryEntry["expense"]>) => historyStore.update(entry.id, { expense: { ...entry.expense, ...patch } });

  if (!bill) {
    // Papers (ID, insurance…) aren't bills; any other document can be followed as one.
    if (paperKind(entry)) return null;
    return (
      <div className={styles.controls}>
        <Button variant="ghost" size="md" icon={<Receipt />} onClick={() => void setExpense({ hidden: false })}>
          {t("bills.follow")}
        </Button>
      </div>
    );
  }

  const saveAmount = (value: string) => {
    const amount = parseNumber(value);
    const amountMga = amount && amount > 0 ? Math.round(amount) : undefined;
    if (amountMga !== bill.amountMga) void setExpense({ amountMga });
  };

  return (
    <div className={styles.controls}>
      <p className={styles.status}>
        <Receipt size={15} />
        <span>
          {[t("bills.title"), bill.issuer, t(`bills.kinds.${bill.kind}`)].filter(Boolean).join(" · ")}{" "}
          <Link href="/papers?tab=bills">{t("papers.open")}</Link>
        </span>
      </p>
      <div className={styles.fields}>
        <label>
          <span>{t("bills.amount")}</span>
          <input
            key={bill.amountMga ?? "none"}
            defaultValue={bill.amountMga ?? ""}
            inputMode="numeric"
            placeholder={bill.foreignAmount ? t("bills.readAmount", { amount: bill.foreignAmount }) : "0"}
            onBlur={(event) => saveAmount(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
          />
        </label>
        <div className={styles.billState}>
          <span>{t("bills.state")}</span>
          {bill.paidAt ? (
            <Button variant="secondary" size="md" icon={<Undo2 />} onClick={() => void setExpense({ paidAt: undefined })}>
              {t("bills.paidOn", { date: formatDate(bill.paidAt, locale) })}
            </Button>
          ) : (
            <Button
              size="md"
              icon={<CircleCheck />}
              onClick={() => {
                haptics.success();
                void setExpense({ paidAt: timestamp() });
              }}
            >
              {t("bills.markPaid")}
            </Button>
          )}
        </div>
      </div>
      <p className={styles.billNote}>
        {bill.amountMga !== null && formatAriary(bill.amountMga, locale)}
        {bill.dueAt !== null && !bill.paidAt && (
          <span data-overdue={bill.status === "overdue" || undefined}>
            {bill.status === "overdue" ? t("bills.overdueSince", { date: formatDate(bill.dueAt, locale) }) : t("bills.dueOn", { date: formatDate(bill.dueAt, locale) })}
          </span>
        )}
        <button type="button" onClick={() => void setExpense({ hidden: true })}>
          {t("bills.unfollow")}
        </button>
      </p>
    </div>
  );
}
