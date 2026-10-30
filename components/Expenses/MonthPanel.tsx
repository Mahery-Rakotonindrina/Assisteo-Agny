import { useEffect, useState } from "react";
import { Camera, CalendarOff, Check, Download, ExternalLink, EyeOff, FileText, Pencil, Plus, Receipt, RotateCcw } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { useDismissed } from "@/hooks/useDismissed";
import { useExpenseLabels } from "@/hooks/useExpenseLabels";
import { useNow } from "@/hooks/useNow";
import { useTranslation } from "@/hooks/useTranslation";
import { expenseFileName, expensesWorkbook, XLSX_TYPE } from "@/lib/expenseExport";
import {
  barPercent,
  categoryBars,
  compareMonths,
  dayStart,
  groupByDay,
  keepKey,
  monthStart,
  monthTotals,
  type Budget,
  type BudgetLine,
  type ExpenseRecord,
  type IncomeItem,
  type ManualExpense,
  type MonthItem,
} from "@/lib/expenses";
import { formatAriary, formatDate, formatMonthYear } from "@/lib/format";
import { lineWallet, type WalletBook } from "@/lib/wallets";
import { expenseStore } from "@/services/expenseStore";
import { shareFile } from "@/services/fileShare";
import { EmptyNote } from "./EmptyNote";
import { ExpenseForm, type LinkChoice, type ShareChoice } from "./ExpenseForm";
import { ExpenseSheet } from "./ExpenseSheet";
import styles from "./Expenses.module.scss";
import { ImportedBadge, StatementImport } from "./StatementImport";
import { WalletChips, type PocketChoice } from "./WalletChips";
import type { ActivityMonth } from "@/lib/resale";

type Props = {
  month: string;
  records: ExpenseRecord[];
  items: MonthItem[];
  incomes: IncomeItem[];
  /** The caps set (for "where your money goes"), and the month against them (for the export). */
  budget?: Budget;
  budgetLines: BudgetLine[];
  previousTotal: number;
  /** An expense to open in the form right away (from a scanned receipt). */
  initialEditing?: ManualExpense | null;
  /** The add form, open right away (from the evening reminder). */
  adding?: boolean;
  onEdited?: () => void;
  /** The household an expense can be moved to, when the user is a member. */
  share?: ShareChoice | null;
  /** A line to show first and open (from "Counted in My expenses →"). */
  focus?: string | null;
  /** The pockets: the one each line is taken from, and the ones a form offers. */
  book?: WalletBook;
  pockets?: PocketChoice;
  /** "Mon activité" for the export: with the reseller tools and the activity kept apart only. */
  activity?: ActivityMonth | null;
};

const DAY = 86_400_000;

/** The month: where the money goes, every line by day, and the export. */
export function MonthPanel({ month, records, items, incomes, budget, budgetLines, previousTotal, initialEditing, adding, onEdited, share, focus, book, pockets, activity }: Props) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const now = useNow(60_000);
  const { categoryName, categoryColor } = useExpenseLabels(records);
  const [editing, setEditing] = useState<Partial<ManualExpense> | null>(initialEditing ?? (adding ? { at: defaultDay(month) } : null));
  const [opened, setOpened] = useState<string | null>(focus ?? null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [helpSeen, closeHelp] = useDismissed("expenses.excludeHelp");
  const totals = monthTotals(items);
  const bars = categoryBars(totals, budget);
  const comparison = compareMonths(totals.total, previousTotal);
  const money = (value: number) => formatAriary(value, locale);
  const days = groupByDay(items, filter);
  const today = dayStart(now);

  // The line asked for, brought into view.
  useEffect(() => {
    if (!focus) return;
    const timer = setTimeout(() => document.querySelector(`[data-key="${CSS.escape(focus)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 300);
    return () => clearTimeout(timer);
  }, [focus]);

  // The computed lines a manual expense can stand for.
  const links: LinkChoice[] = items
    .filter((item) => item.origin !== "manual")
    .map((item) => ({ key: item.key, label: [t(`expenses.origins.${item.origin}`), item.label, money(item.amountMga)].filter(Boolean).join(" · ") }));

  const exportMonth = async (kind: "xlsx" | "pdf") => {
    if (exporting) return;
    setExporting(true);
    const data = { month, items, incomes, budget: budgetLines, categoryName, book, records, activity };
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

  const closeForm = () => {
    setEditing(null);
    setOpened(null);
    onEdited?.();
  };

  const dayLabel = (day: number) => (day === today ? t("expenses.month.today") : day === dayStart(today - DAY / 2) ? t("expenses.month.yesterday") : formatDate(day, locale));

  return (
    <div className={styles.panel}>
      <div className={styles.actionRow}>
        <Button size="lg" icon={<Plus />} onClick={() => setEditing({ at: defaultDay(month) })}>
          {t("expenses.add")}
        </Button>
        <Button size="lg" variant="secondary" icon={<Camera />} href="/?mode=document">
          {t("expenses.receiptPhoto")}
        </Button>
        <StatementImport records={records} book={book} />
      </div>

      {items.length === 0 ? (
        <EmptyNote icon={<Receipt />} texts="expenses.month.empty" />
      ) : (
        <div className={styles.split}>
          <section className={styles.where} aria-labelledby="expenses-where">
            <h2 id="expenses-where" className={styles.subTitle}>
              {t("expenses.month.where")}
            </h2>
            {(previousTotal > 0 || totals.total > 0) && (
              <p className={styles.hint}>
                {comparison.percent === null
                  ? t("expenses.month.noPrevious")
                  : t(comparison.difference > 0 ? "expenses.month.more" : "expenses.month.less", {
                      percent: Math.abs(comparison.percent),
                      amount: money(Math.abs(comparison.difference)),
                    })}
              </p>
            )}
            <ul className={styles.bars}>
              {bars.map((line) => (
                <li key={line.category}>
                  <button
                    type="button"
                    className={styles.barButton}
                    aria-pressed={filter === line.category}
                    onClick={() => setFilter(filter === line.category ? null : line.category)}
                  >
                    <span className={styles.barLabel}>
                      <span>
                        <i className={styles.dot} style={{ background: categoryColor(line.category) }} />
                        {categoryName(line.category)}
                      </span>
                      <small>{line.cap ? `${money(line.amount)} / ${money(line.cap)}` : `${money(line.amount)} · ${barPercent(line.ratio)} %`}</small>
                    </span>
                    <span className={styles.track} data-level={line.level ?? undefined} style={{ "--tone": categoryColor(line.category) } as React.CSSProperties}>
                      <span style={{ width: `${barPercent(line.ratio)}%` }} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {bars.length > 1 && <p className={styles.hint}>{t("expenses.month.whereHint")}</p>}
          </section>

          <section aria-labelledby="expenses-list">
            <div className={styles.listHead}>
              <h2 id="expenses-list" className={styles.subTitle}>
                {filter ? categoryName(filter) : t("expenses.month.list")}
              </h2>
              {filter && (
                <button type="button" className={styles.linkButton} onClick={() => setFilter(null)}>
                  {t("expenses.month.all")}
                </button>
              )}
            </div>
            {days.length === 0 && <p className={styles.hint}>{t("expenses.month.noneInCategory")}</p>}
            {days.map(({ day, items: lines }) => (
              <div key={day} className={styles.dayGroup}>
                <h3 className={styles.day}>{dayLabel(day)}</h3>
                <ul className={styles.entries}>
                  {lines.map((item) => {
                    const computed = item.origin !== "manual";
                    const open = opened === item.key;
                    return (
                      <li key={item.key} data-key={item.key} className={styles.entry} data-excluded={item.excluded || undefined} data-fresh={fresh === item.key || focus === item.key || undefined}>
                        <button
                          type="button"
                          className={styles.entryMain}
                          aria-expanded={computed ? open : undefined}
                          onClick={() => (computed ? setOpened(open ? null : item.key) : setEditing(item.record!))}
                        >
                          <i className={styles.dot} style={{ background: categoryColor(item.category) }} />
                          <span className={styles.entryText}>
                            <strong>{item.origin === "fees" ? t("expenses.feesLabel") : item.label || categoryName(item.category)}</strong>
                            <small>
                              {computed && <span className={styles.badge}>{t("expenses.auto", { origin: t(`expenses.origins.${item.origin}`) })}</span>}
                              {item.doubt && <span className={styles.badge} data-tone="warning">{t("expenses.doubt")}</span>}
                              <ImportedBadge record={item.record} />
                              {[item.label && categoryName(item.category), item.record?.payment && t(`expenses.payments.${item.record.payment}`), item.excluded && !item.doubt && t("expenses.excluded")]
                                .filter(Boolean)
                                .join(" · ")}
                              {item.record?.currency && ` · ${item.record.originalAmount} ${item.record.currency}`}
                            </small>
                          </span>
                          <span className={styles.amount}>{money(item.amountMga)}</span>
                        </button>
                        {computed && open && (
                          <div className={styles.actions}>
                            {item.doubt && <p className={styles.hint}>{t("expenses.doubtHint")}</p>}
                            {item.href && (
                              <Button variant="ghost" href={item.href} icon={<ExternalLink />}>
                                {t("expenses.openSource")}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              icon={<Pencil />}
                              onClick={() =>
                                setEditing({
                                  at: item.at,
                                  amountMga: item.amountMga,
                                  category: item.category,
                                  note: item.label,
                                  payment: item.recurring?.payment,
                                  sourceKey: item.key,
                                  scanId: item.scanId,
                                  reference: item.reference,
                                  wallet: book && lineWallet(book.context, item),
                                })
                              }
                            >
                              {t("expenses.correct")}
                            </Button>
                            {item.doubt ? (
                              <Button variant="ghost" icon={<Check />} onClick={() => void expenseStore.setExcluded(keepKey(item.key), true)}>
                                {t("expenses.keepAnyway")}
                              </Button>
                            ) : item.recurring ? (
                              <Button variant="ghost" icon={<CalendarOff />} onClick={() => void expenseStore.setSkipped(item.recurring!.id, month, true)}>
                                {t("expenses.recurring.skip")}
                              </Button>
                            ) : (
                              <Button variant="ghost" icon={item.excluded ? <RotateCcw /> : <EyeOff />} onClick={() => void expenseStore.setExcluded(item.key, !item.excluded)}>
                                {t(item.excluded ? "expenses.include" : "expenses.exclude")}
                              </Button>
                            )}
                            {book && pockets && pockets.wallets.length > 0 && (
                              <div className={styles.linePocket}>
                                <WalletChips
                                  label={t("expenses.pockets.lineWallet")}
                                  wallets={pockets.wallets}
                                  value={lineWallet(book.context, item) ?? ""}
                                  onChange={(id) => void expenseStore.setWalletPick((item as { feesOf?: string }).feesOf ?? item.key, id)}
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {!helpSeen && items.some((item) => item.origin !== "manual") && (
              <div className={styles.tip} role="note">
                <p>{t("expenses.excludeHelp.text")}</p>
                <Button variant="ghost" onClick={closeHelp}>
                  {t("expenses.excludeHelp.ok")}
                </Button>
              </div>
            )}
          </section>
        </div>
      )}

      {items.length > 0 && (
        <section className={styles.panel} aria-labelledby="expenses-export">
          <div>
            <h2 id="expenses-export" className={styles.subTitle}>
              {t("expenses.month.exportTitle")}
            </h2>
            <p className={styles.hint}>{t("expenses.month.exportHint")}</p>
          </div>
          {/* Side by side, sharing the width on a phone. */}
          <div className={styles.exports}>
            <Button variant="secondary" block icon={<Download />} onClick={() => void exportMonth("xlsx")} disabled={exporting}>
              {t("expenses.export.excel")}
            </Button>
            <Button variant="secondary" block icon={<FileText />} onClick={() => void exportMonth("pdf")} disabled={exporting}>
              {t("expenses.export.pdf")}
            </Button>
          </div>
        </section>
      )}

      <ExpenseSheet open={editing !== null} title={editing?.id ? t("expenses.edit") : t("expenses.add")} onClose={closeForm}>
        {editing && (
          <ExpenseForm
            key={editing.id ?? editing.sourceKey ?? "new"}
            records={records}
            initial={editing}
            links={links.filter((link) => link.key !== editing.sourceKey)}
            share={share}
            pockets={pockets}
            onSaved={(saved) => {
              if (editing.id || saved.amountMga === undefined) toast(t("expenses.saved.changed"));
              else toast(t("expenses.saved.expense", { amount: money(saved.amountMga), category: categoryName(saved.category ?? "other") }));
              if (saved.id) setFresh(`manual:${saved.id}`);
              setFilter(null);
            }}
            onDone={closeForm}
          />
        )}
      </ExpenseSheet>
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
