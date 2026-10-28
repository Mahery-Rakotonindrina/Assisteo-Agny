import { useState } from "react";
import { SegmentedControl } from "@/components/SegmentedControl";
import { useExpenseLabels } from "@/hooks/useExpenseLabels";
import { useTranslation } from "@/hooks/useTranslation";
import { monthStart, spendingHistory, type ExpenseRecord, type MonthItem } from "@/lib/expenses";
import { formatAriary, formatCompact, formatMonth } from "@/lib/format";
import styles from "./Expenses.module.scss";

type Props = { month: string; records: ExpenseRecord[]; sources: Array<Omit<MonthItem, "excluded">> };

/** Month by month over 6 or 12 months, and the monthly average per category. */
export function HistoryPanel({ month, records, sources }: Props) {
  const { t, locale } = useTranslation();
  const { categoryName, categoryColor } = useExpenseLabels(records);
  const [count, setCount] = useState<"6" | "12">("6");
  const history = spendingHistory(records, sources, month, Number(count));
  const highest = Math.max(1, ...history.months.map((item) => item.total));
  const money = (value: number) => formatAriary(value, locale);

  return (
    <div className={styles.panel}>
      <SegmentedControl
        ariaLabel={t("expenses.history.period")}
        value={count}
        onChange={setCount}
        options={[
          { value: "6", label: t("expenses.history.months", { count: 6 }) },
          { value: "12", label: t("expenses.history.months", { count: 12 }) },
        ]}
      />
      <div className={styles.stats}>
        <span>
          <small>{t("expenses.history.average")}</small>
          <strong>{money(history.average)}</strong>
        </span>
        <span>
          <small>{t("expenses.history.total")}</small>
          <strong>{money(history.months.reduce((total, item) => total + item.total, 0))}</strong>
        </span>
      </div>
      <div className={styles.chart} role="img" aria-label={t("expenses.history.chart")}>
        {history.months.map((item) => (
          <span key={item.month} title={`${formatMonth(monthStart(item.month), locale)} : ${money(item.total)}`}>
            {/* Twelve amounts don't fit a phone: the bars alone, the amount in the title. */}
            {count === "6" && <small>{item.total > 0 ? formatCompact(item.total, locale) : "—"}</small>}
            <span className={styles.column}>
              <span style={{ height: `${(item.total / highest) * 100}%` }} />
            </span>
            <small>{formatMonth(monthStart(item.month), locale)}</small>
          </span>
        ))}
      </div>
      {history.averages.length > 0 && (
        <section>
          <h2 className={styles.subTitle}>{t("expenses.history.byCategory")}</h2>
          <ul className={styles.bars}>
            {history.averages.map((line) => (
              <li key={line.category}>
                <span className={styles.barLabel}>
                  <span>
                    <i className={styles.dot} style={{ background: categoryColor(line.category) }} />
                    {categoryName(line.category)}
                  </span>
                  <small>{t("expenses.history.perMonth", { amount: money(line.amount) })}</small>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
