import { motion } from "motion/react";
import { useRouter } from "next/router";
import { useMemo, useState } from "react";
import { CalendarSync, ChevronLeft, ChevronRight, History, PiggyBank, Receipt, User, Users, Wallet } from "lucide-react";
import { BudgetPanel, HistoryPanel, HouseholdPanel, IncomePanel, MonthPanel, MonthReview, RecurringPanel } from "@/components/Expenses";
import styles from "@/components/Expenses/Expenses.module.scss";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Seo } from "@/components/Seo";
import { useExpenses } from "@/hooks/useExpenses";
import { useExpenseSources } from "@/hooks/useExpenseSources";
import { useHousehold } from "@/hooks/useHousehold";
import { useNow } from "@/hooks/useNow";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { BUDGET_ID, budgetLines, hasOwnExpenses, monthExpenses, monthIncomes, monthKey, monthStart, monthTotals, shiftMonth, type Budget, type ManualExpense } from "@/lib/expenses";
import { formatMonthYear } from "@/lib/format";
import { rise, stagger } from "@/lib/motion";

type Tab = "month" | "income" | "recurring" | "history" | "budget";
type View = "personal" | "household";

/**
 * "Mes dépenses": the monthly budget, personal and shared with the household.
 * Admin only while tested, and hidden from the other plans (no lock, no
 * label). Any signed-in account may join a household with a code: the other
 * plans get the household's view only ("Budget du foyer").
 */
export default function ExpensesPage() {
  const { t } = useTranslation();
  const { plan, has } = usePlan();
  const router = useRouter();
  // Null on the server and at hydration: nothing is shown until the plan is read.
  const known = plan !== null;
  const allowed = has("expenses");
  const joinCode = typeof router.query.join === "string" ? router.query.join : undefined;

  return (
    <>
      <Seo title={`${allowed ? t("expenses.title") : t("expenses.household.title")} · ${t("meta.title")}`} noindex />
      {!known ? null : allowed ? <Expenses canRemind={has("reminders")} joinCode={joinCode} /> : <HouseholdOnly joinCode={joinCode} />}
    </>
  );
}

/** The other plans: the household's month, or how to join one. */
function HouseholdOnly({ joinCode }: { joinCode?: string }) {
  const { t } = useTranslation();
  const now = useNow(60_000);
  const [picked, setPicked] = useState<string | null>(null);
  const month = picked ?? monthKey(now);
  const member = Boolean(useHousehold()?.household);
  // Lost with the plan: one's own expenses stay on the device, shown read-only (reminders paused by their keeper).
  const { records } = useExpenses();
  const sources = useExpenseSources();
  const kept = hasOwnExpenses(records);

  return (
    <motion.div className={styles.page} variants={stagger} initial="hidden" animate="show">
      <motion.header variants={rise} className={styles.header}>
        <h1>{t("expenses.household.title")}</h1>
        <p>{t("expenses.household.subtitle")}</p>
      </motion.header>
      {member && <MonthPicker month={month} onPick={setPicked} />}
      {kept && (
        <motion.div variants={rise}>
          <p className={styles.hint}>{t("expenses.keptReadOnly")}</p>
          <HistoryPanel month={month} records={records} sources={sources} />
        </motion.div>
      )}
      <motion.div variants={rise}>
        <HouseholdPanel month={month} records={[]} canCreate={false} canMove={false} joinCode={joinCode} />
      </motion.div>
    </motion.div>
  );
}

function MonthPicker({ month, onPick }: { month: string; onPick: (month: string) => void }) {
  const { t, locale } = useTranslation();
  return (
    <motion.div variants={rise} className={styles.monthPicker}>
      <button type="button" className={styles.iconButton} onClick={() => onPick(shiftMonth(month, -1))} aria-label={t("expenses.previousMonth")}>
        <ChevronLeft size={20} />
      </button>
      <strong aria-live="polite">{formatMonthYear(monthStart(month), locale)}</strong>
      <button type="button" className={styles.iconButton} onClick={() => onPick(shiftMonth(month, 1))} aria-label={t("expenses.nextMonth")}>
        <ChevronRight size={20} />
      </button>
    </motion.div>
  );
}

function Expenses({ canRemind, joinCode }: { canRemind: boolean; joinCode?: string }) {
  const { t } = useTranslation();
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
  // "?join=" (an invitation) or "?view=household" opens the household's side.
  const [chosenView, setView] = useState<View | null>(null);
  const view: View = opened ? "personal" : (chosenView ?? (joinCode || router.query.view === "household" ? "household" : "personal"));
  const snapshot = useHousehold();
  const household = snapshot?.household ?? null;
  const share = household ? { name: household.name, me: snapshot?.userId ?? null, choose: true } : null;
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

  const figures = useMemo(() => {
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
  const pickView = (value: View) => {
    closeOpened();
    setView(value);
  };

  const defaultAt = month === current ? now : monthStart(month);

  return (
    <motion.div className={styles.page} variants={stagger} initial="hidden" animate="show">
      <motion.header variants={rise} className={styles.header}>
        <h1>{t("expenses.title")}</h1>
        <p>{t("expenses.subtitle")}</p>
      </motion.header>

      <motion.div variants={rise}>
        <SegmentedControl
          ariaLabel={t("expenses.views.label")}
          value={view}
          onChange={pickView}
          options={[
            { value: "personal", label: t("expenses.views.personal"), icon: <User /> },
            { value: "household", label: t("expenses.views.household"), icon: <Users /> },
          ]}
        />
      </motion.div>

      <MonthPicker month={month} onPick={pickMonth} />

      {view === "household" ? (
        <motion.div variants={rise}>
          <HouseholdPanel month={month} records={records} canCreate canMove joinCode={joinCode} />
        </motion.div>
      ) : (
        <>
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
                <MonthPanel key={`${month}:${opened?.id ?? ""}`} share={share} month={month} initialEditing={opened} onEdited={closeOpened} records={records} items={figures.items} incomes={figures.incomes} budget={figures.budget} previousTotal={figures.previousTotal} />
                {/* Keyed by month: a review asked for another month never shows under this one. */}
                <MonthReview key={month} month={month} records={records} sources={sources} />
              </div>
            ) : tab === "income" ? (
              <IncomePanel key={month} month={month} incomes={figures.incomes} spent={figures.totals.total} defaultAt={defaultAt} />
            ) : tab === "recurring" ? (
              <RecurringPanel month={month} records={records} canRemind={canRemind} />
            ) : tab === "history" ? (
              <HistoryPanel month={month} records={records} sources={sources} />
            ) : (
              <BudgetPanel key={figures.budgetVersion} records={records} />
            )}
          </motion.div>
        </>
      )}
    </motion.div>
  );
}
