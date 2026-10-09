import Link from "next/link";
import { motion } from "motion/react";
import { useMemo } from "react";
import { CircleCheck, Receipt, ScanLine } from "lucide-react";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { useNow } from "@/hooks/useNow";
import { useTranslation } from "@/hooks/useTranslation";
import { billTotals, listBills, monthlySpending, spendingByKind, type Bill } from "@/lib/bills";
import { formatAriary, formatDate } from "@/lib/format";
import { rise } from "@/lib/motion";
import { haptics } from "@/services/device";
import { historyStore } from "@/services/historyStore";
import type { HistoryEntry } from "@/types/history";
import styles from "./BillsPanel.module.scss";

// Taken in event handlers (never during render).
const timestamp = () => Date.now();

/** "Mes factures": followed bills, what was spent each month and what is left to pay. */
export function BillsPanel({ entries, loading }: { entries: HistoryEntry[]; loading: boolean }) {
  const { t, locale } = useTranslation();
  const now = useNow(60_000);
  const bills = useMemo(() => listBills(entries, now), [entries, now]);
  const totals = billTotals(bills, now);
  const months = monthlySpending(bills, now);
  const peak = Math.max(1, ...months.map((month) => month.total));
  const kinds = spendingByKind(bills, now);

  if (!loading && bills.length === 0) {
    return (
      <motion.div variants={rise}>
        <EmptyState
          title={t("bills.emptyTitle")}
          body={t("bills.emptyBody")}
          action={
            <Button href="/?mode=document" icon={<ScanLine />}>
              {t("bills.scan")}
            </Button>
          }
        />
      </motion.div>
    );
  }

  const togglePaid = (bill: Bill<HistoryEntry>) => {
    haptics.tap();
    void historyStore.update(bill.entry.id, { expense: { ...bill.entry.expense, paidAt: bill.paidAt ? undefined : timestamp() } });
  };

  const when = (bill: Bill) => {
    if (bill.paidAt) return t("bills.paidOn", { date: formatDate(bill.paidAt, locale) });
    if (bill.dueAt === null) return t("bills.noDue");
    return bill.status === "overdue" ? t("bills.overdueSince", { date: formatDate(bill.dueAt, locale) }) : t("bills.dueOn", { date: formatDate(bill.dueAt, locale) });
  };

  return (
    <>
      <motion.section variants={rise} className={styles.summary}>
        <div className={styles.totals}>
          <span>
            <small>{t("bills.thisMonth")}</small>
            <strong>{formatAriary(totals.thisMonth, locale)}</strong>
          </span>
          <span data-due={totals.toPay > 0 || undefined}>
            <small>{t("bills.toPay")}</small>
            <strong>{formatAriary(totals.toPay, locale)}</strong>
          </span>
        </div>
        <div className={styles.chart} aria-label={t("bills.months")}>
          {months.map(({ month, total }) => (
            <span key={month} title={formatAriary(total, locale)}>
              <span className={styles.column}>
                <span style={{ height: `${(total / peak) * 100}%` }} />
              </span>
              <small>{new Date(month).toLocaleDateString(locale, { month: "short" })}</small>
            </span>
          ))}
        </div>
        {kinds.length > 0 && (
          <ul className={styles.kinds}>
            {kinds.map(({ kind, total }) => (
              <li key={kind}>
                {t(`bills.kinds.${kind}`)} <strong>{formatAriary(total, locale)}</strong>
              </li>
            ))}
          </ul>
        )}
        {totals.unpriced > 0 && <p className={styles.unpriced}>{t("bills.unpriced", { count: totals.unpriced })}</p>}
      </motion.section>

      <motion.ul variants={rise} className={styles.list}>
        {bills.map((bill) => (
          <li key={bill.entry.id} className={styles.bill} data-status={bill.status}>
            <Link href={{ pathname: "/result", query: { id: bill.entry.id } }} className={styles.billMain}>
              {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
              {bill.entry.thumbnail ? <img src={bill.entry.thumbnail} alt="" /> : <Receipt size={20} />}
              <span className={styles.text}>
                <strong>{bill.issuer ?? bill.entry.analysis.title}</strong>
                <small>
                  {t(`bills.kinds.${bill.kind}`)} · {bill.amountMga !== null ? formatAriary(bill.amountMga, locale) : t("bills.noAmount")}
                </small>
                <span className={styles.when}>{when(bill)}</span>
              </span>
            </Link>
            <button type="button" className={styles.paid} aria-pressed={Boolean(bill.paidAt)} onClick={() => togglePaid(bill)} aria-label={t("bills.markPaid")}>
              <CircleCheck size={20} />
            </button>
          </li>
        ))}
      </motion.ul>
    </>
  );
}
