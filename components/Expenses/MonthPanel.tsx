import { useState } from "react";
import { AlertTriangle, CalendarOff, Download, ExternalLink, EyeOff, FileText, Pencil, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { useExpenseLabels } from "@/hooks/useExpenseLabels";
import { useTranslation } from "@/hooks/useTranslation";
import { expenseFileName, expensesWorkbook, monthFigures, XLSX_TYPE } from "@/lib/expenseExport";
import { compareMonths, monthStart, monthTotals, type BudgetLine, type ExpenseRecord, type IncomeItem, type ManualExpense, type MonthItem } from "@/lib/expenses";
import { formatAriary, formatDate, formatMonthYear } from "@/lib/format";
import { expenseStore } from "@/services/expenseStore";
import { shareFile } from "@/services/fileShare";
import { ExpenseForm, type LinkChoice } from "./ExpenseForm";
import styles from "./Expenses.module.scss";

type Props = {
  month: string;
  records: ExpenseRecord[];
  items: MonthItem[];
  incomes: IncomeItem[];
  budget: BudgetLine[];
  previousTotal: number;
  /** An expense to open in the form right away (from a scanned receipt). */
  initialEditing?: ManualExpense | null;
  onEdited?: () => void;
};

/** The month: total, comparison, budget, split by category, and every line. */
export function MonthPanel({ month, records, items, incomes, budget, previousTotal, initialEditing, onEdited }: Props) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const { categoryName, categoryColor } = useExpenseLabels(records);
  const [editing, setEditing] = useState<Partial<ManualExpense> | null>(initialEditing ?? null);
  const [opened, setOpened] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const totals = monthTotals(items);
  const { earned, left } = monthFigures({ items, incomes });
  const comparison = compareMonths(totals.total, previousTotal);
  const money = (value: number) => formatAriary(value, locale);
  const worst = budget.find((line) => line.level === "over") ?? budget.find((line) => line.level === "warning");
  const scopeName = (scope: string) => (scope === "total" ? t("expenses.budget.overall") : categoryName(scope));

  // The computed lines a manual expense can stand for.
  const links: LinkChoice[] = items
    .filter((item) => item.origin !== "manual")
    .map((item) => ({ key: item.key, label: [t(`expenses.origins.${item.origin}`), item.label, money(item.amountMga)].filter(Boolean).join(" · ") }));

  const exportMonth = async (kind: "xlsx" | "pdf") => {
    if (exporting) return;
    setExporting(true);
    const data = { month, items, incomes, budget, categoryName };
    const heading = {
      title: `${t("expenses.title")} · ${formatMonthYear(monthStart(month), locale)}`,
      subtitle: t("expenses.export.exportedOn", { date: formatDate(Date.now(), locale) }),
    };
    try {
      const bytes =
        kind === "xlsx"
          ? await expensesWorkbook(data, t, heading)
          : await (await import("@/services/expensePdf")).expensesPdf(data, t, locale, heading);
      const result = await shareFile(expenseFileName(month, kind), bytes, kind === "xlsx" ? XLSX_TYPE : "application/pdf", t("expenses.title"));
      if (result === "downloaded") toast(t("expenses.export.downloaded"));
    } catch {
      toast(t("expenses.export.failed"), "error");
    } finally {
      setExporting(false);
    }
  };

  if (editing)
    return (
      <ExpenseForm
        key={editing.id ?? editing.sourceKey ?? "new"}
        records={records}
        initial={editing}
        links={links.filter((link) => link.key !== editing.sourceKey)}
        onDone={() => {
          setEditing(null);
          setOpened(null);
          onEdited?.();
        }}
      />
    );

  return (
    <div className={styles.panel}>
      <div className={styles.stats}>
        <span>
          <small>{t("expenses.month.spent")}</small>
          <strong data-testid="expenses-total">{money(totals.total)}</strong>
          {(previousTotal > 0 || totals.total > 0) && (
            <em>
              {comparison.percent === null
                ? t("expenses.month.noPrevious")
                : t(comparison.difference > 0 ? "expenses.month.more" : "expenses.month.less", {
                    percent: Math.abs(comparison.percent),
                    amount: money(Math.abs(comparison.difference)),
                  })}
            </em>
          )}
        </span>
        <span>
          <small>{t("expenses.month.lastMonth")}</small>
          <strong>{money(previousTotal)}</strong>
        </span>
        {earned > 0 && (
          <span>
            <small>{t("expenses.income.left")}</small>
            <strong data-tone={left < 0 ? "bad" : undefined}>{money(left)}</strong>
          </span>
        )}
      </div>

      {worst && worst.level !== "ok" && (
        <p className={styles.banner} data-level={worst.level} role="status">
          <AlertTriangle size={18} />
          <span>
            {t(worst.level === "over" ? "expenses.budget.overBanner" : "expenses.budget.warningBanner", {
              scope: scopeName(worst.scope),
              percent: Math.round(worst.ratio * 100),
              amount: money(Math.abs(worst.cap - worst.spent)),
            })}
          </span>
        </p>
      )}

      {budget.length > 0 && (
        <section>
          <h2 className={styles.subTitle}>{t("expenses.budget.title")}</h2>
          <ul className={styles.bars}>
            {budget.map((line) => (
              <li key={line.scope}>
                <span className={styles.barLabel}>
                  <span>{scopeName(line.scope)}</span>
                  <small>
                    {money(line.spent)} / {money(line.cap)}
                  </small>
                </span>
                <span className={styles.track} data-level={line.level}>
                  <span style={{ width: `${Math.min(100, line.ratio * 100)}%` }} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {totals.byCategory.length > 0 && (
        <section>
          <h2 className={styles.subTitle}>{t("expenses.month.byCategory")}</h2>
          <ul className={styles.bars}>
            {totals.byCategory.map((line) => (
              <li key={line.category}>
                <span className={styles.barLabel}>
                  <span>
                    <i className={styles.dot} style={{ background: categoryColor(line.category) }} />
                    {categoryName(line.category)}
                  </span>
                  <small>
                    {money(line.amount)} · {Math.round((line.amount / totals.total) * 100)} %
                  </small>
                </span>
                <span className={styles.track} style={{ "--tone": categoryColor(line.category) } as React.CSSProperties}>
                  <span style={{ width: `${(line.amount / totals.byCategory[0].amount) * 100}%` }} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className={styles.row}>
        <Button icon={<Plus />} onClick={() => setEditing({ at: defaultDay(month) })}>
          {t("expenses.add")}
        </Button>
      </div>
      {items.length > 0 && (
        // Side by side, sharing the width on a phone.
        <div className={styles.exports}>
          <Button variant="secondary" block icon={<Download />} onClick={() => void exportMonth("xlsx")} disabled={exporting}>
            {t("expenses.export.excel")}
          </Button>
          <Button variant="secondary" block icon={<FileText />} onClick={() => void exportMonth("pdf")} disabled={exporting}>
            {t("expenses.export.pdf")}
          </Button>
        </div>
      )}

      <section>
        <h2 className={styles.subTitle}>{t("expenses.month.list")}</h2>
        {items.length === 0 ? (
          <p className={styles.hint}>{t("expenses.month.empty")}</p>
        ) : (
          <ul className={styles.entries}>
            {items.map((item) => {
              const computed = item.origin !== "manual";
              const open = opened === item.key;
              return (
                <li key={item.key} className={styles.entry} data-excluded={item.excluded || undefined}>
                  <button
                    type="button"
                    className={styles.entryMain}
                    aria-expanded={computed ? open : undefined}
                    onClick={() => (computed ? setOpened(open ? null : item.key) : setEditing(item.record!))}
                  >
                    <i className={styles.dot} style={{ background: categoryColor(item.category) }} />
                    <span className={styles.entryText}>
                      <strong>{item.label || categoryName(item.category)}</strong>
                      <small>
                        {computed && <span className={styles.badge}>{t(`expenses.origins.${item.origin}`)}</span>}
                        {[formatDate(item.at, locale), item.label && categoryName(item.category), item.record?.payment && t(`expenses.payments.${item.record.payment}`), item.excluded && t("expenses.excluded")]
                          .filter(Boolean)
                          .join(" · ")}
                        {item.record?.currency && ` · ${item.record.originalAmount} ${item.record.currency}`}
                      </small>
                    </span>
                    <span className={styles.amount}>{money(item.amountMga)}</span>
                  </button>
                  {computed && open && (
                    <div className={styles.actions}>
                      {item.href && (
                        <Button variant="ghost" href={item.href} icon={<ExternalLink />}>
                          {t("expenses.openSource")}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        icon={<Pencil />}
                        onClick={() => setEditing({ at: item.at, amountMga: item.amountMga, category: item.category, note: item.label, payment: item.recurring?.payment, sourceKey: item.key })}
                      >
                        {t("expenses.correct")}
                      </Button>
                      {item.recurring ? (
                        <Button variant="ghost" icon={<CalendarOff />} onClick={() => void expenseStore.setSkipped(item.recurring!.id, month, true)}>
                          {t("expenses.recurring.skip")}
                        </Button>
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
        )}
        {items.some((item) => item.origin !== "manual") && <p className={styles.hint}>{t("expenses.month.sourcesHint")}</p>}
      </section>
    </div>
  );
}

/** A new expense is dated today in the current month, else on the 1st of the month shown. */
function defaultDay(month: string) {
  const now = Date.now();
  const start = monthStart(month);
  const [year, index] = month.split("-").map(Number);
  const end = new Date(year, index, 1).getTime();
  return now >= start && now < end ? now : start;
}
