import { motion } from "motion/react";
import { useRouter } from "next/router";
import { useMemo, useState } from "react";
import { CalendarSync, ChevronLeft, ChevronRight, History, PiggyBank, Receipt, Wallet } from "lucide-react";
import { BudgetPanel, HistoryPanel, IncomePanel, MonthPanel, MonthReview, RecurringPanel } from "@/components/Expenses";
import styles from "@/components/Expenses/Expenses.module.scss";
import { EmptyState } from "@/components/EmptyState";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Seo } from "@/components/Seo";
import { useExpenses } from "@/hooks/useExpenses";
import { useExpenseSources } from "@/hooks/useExpenseSources";
import { useNow } from "@/hooks/useNow";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { BUDGET_ID, budgetLines, monthExpenses, monthIncomes, monthKey, monthStart, monthTotals, shiftMonth, type Budget, type ManualExpense } from "@/lib/expenses";
import { formatMonthYear } from "@/lib/format";
import { rise, stagger } from "@/lib/motion";

type Tab = "month" | "income" | "recurring" | "history" | "budget";

/**
 * "Mes dépenses": the household's monthly budget. Admin only while tested,
 * and hidden from the other plans (no lock, no label): they get a plain
 * "not available".
 */
export default function ExpensesPage() {
  const { t } = useTranslation();
  const { plan, has } = usePlan();
  // Null on the server and at hydration: nothing is shown until the plan is read.
  const known = plan !== null;
  const allowed = has("expenses");

  return (
    <>
      <Seo title={`${allowed ? t("expenses.title") : t("expenses.unavailableTitle")} · ${t("meta.title")}`} noindex />
      {!known ? null : allowed ? (
        <Expenses canRemind={has("reminders")} />
      ) : (
        <div className={styles.page}>
          <EmptyState title={t("expenses.unavailableTitle")} body={t("expenses.unavailableBody")} />
        </div>
      )}
    </>
  );
}

function Expenses({ canRemind }: { canRemind: boolean }) {
  const { t, locale } = useTranslation();
  const now = useNow(60_000);
  const { records } = useExpenses();
  const sources = useExpenseSources();
  const current = monthKey(now);
  const router = useRouter();
  // "?open=<id>" (from a scanned receipt): that expense, open in the form, in its month.
  const openId = typeof router.query.open === "string" ? router.query.open : null;
  const opened = openId ? records.find((record): record is ManualExpense => record.kind === "expense" && record.id === openId) : undefined;
  const [picked, setPicked] = useState<string | null>(null);
  const month = opened ? monthKey(opened.at) : (picked ?? current);
  const [chosenTab, setTab] = useState<Tab>("month");
  const tab = opened ? "month" : chosenTab;
  // Leaving the opened expense keeps its month on screen.
  const closeOpened = () => {
    if (!opened) return;
    setPicked(month);
    setTab("month");
    void router.replace({ pathname: router.pathname }, undefined, { shallow: true });
  };
  const pickMonth = (key: string) => {
    closeOpened();
    setPicked(key);
  };
  const pickTab = (value: Tab) => {
    closeOpened();
    setTab(value);
  };

  const view = useMemo(() => {
    const items = monthExpenses(records, sources, month);
    const totals = monthTotals(items);
    const budget = records.find((record): record is Budget => record.kind === "budget" && record.id === BUDGET_ID);
    return {
      items,
      totals,
      incomes: monthIncomes(records, month),
      previousTotal: monthTotals(monthExpenses(records, sources, shiftMonth(month, -1))).total,
      budget: budgetLines(budget, totals),
      budgetVersion: budget?.updatedAt ?? 0,
    };
  }, [records, sources, month]);

  const defaultAt = month === current ? now : monthStart(month);

  return (
    <motion.div className={styles.page} variants={stagger} initial="hidden" animate="show">
      <motion.header variants={rise} className={styles.header}>
        <h1>{t("expenses.title")}</h1>
        <p>{t("expenses.subtitle")}</p>
      </motion.header>

      <motion.div variants={rise} className={styles.monthPicker}>
        <button type="button" className={styles.iconButton} onClick={() => pickMonth(shiftMonth(month, -1))} aria-label={t("expenses.previousMonth")}>
          <ChevronLeft size={20} />
        </button>
        <strong aria-live="polite">{formatMonthYear(monthStart(month), locale)}</strong>
        <button type="button" className={styles.iconButton} onClick={() => pickMonth(shiftMonth(month, 1))} aria-label={t("expenses.nextMonth")}>
          <ChevronRight size={20} />
        </button>
      </motion.div>

      <motion.div variants={rise}>
        <SegmentedControl
          ariaLabel={t("expenses.title")}
          size="lg"
          value={tab}
          onChange={pickTab}
          options={[
            { value: "month", label: t("expenses.tabs.month"), icon: <Receipt /> },
            { value: "income", label: t("expenses.tabs.income"), icon: <Wallet /> },
            { value: "recurring", label: t("expenses.tabs.recurring"), icon: <CalendarSync /> },
            { value: "history", label: t("expenses.tabs.history"), icon: <History /> },
            { value: "budget", label: t("expenses.tabs.budget"), icon: <PiggyBank /> },
          ]}
        />
      </motion.div>

      <motion.div variants={rise}>
        {tab === "month" ? (
          <div className={styles.panel}>
            <MonthPanel key={`${month}:${opened?.id ?? ""}`} month={month} initialEditing={opened} onEdited={closeOpened} records={records} items={view.items} incomes={view.incomes} budget={view.budget} previousTotal={view.previousTotal} />
            <MonthReview month={month} records={records} sources={sources} />
          </div>
        ) : tab === "income" ? (
          <IncomePanel key={month} month={month} incomes={view.incomes} spent={view.totals.total} defaultAt={defaultAt} />
        ) : tab === "recurring" ? (
          <RecurringPanel month={month} records={records} canRemind={canRemind} />
        ) : tab === "history" ? (
          <HistoryPanel month={month} records={records} sources={sources} />
        ) : (
          <BudgetPanel key={view.budgetVersion} records={records} />
        )}
      </motion.div>
    </motion.div>
  );
}
