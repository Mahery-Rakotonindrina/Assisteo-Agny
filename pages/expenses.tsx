import { motion } from "motion/react";
import { useRouter } from "next/router";
import { useMemo, useState } from "react";
import { AlertTriangle, CalendarSync, ChevronLeft, ChevronRight, History, PiggyBank, Receipt, User, Users, Wallet, X } from "lucide-react";
import { BudgetPanel, HistoryPanel, HouseholdPanel, IncomePanel, MonthPanel, MonthReview, RecurringPanel } from "@/components/Expenses";
import styles from "@/components/Expenses/Expenses.module.scss";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Seo } from "@/components/Seo";
import { useDismissed } from "@/hooks/useDismissed";
import { useExpenseLabels } from "@/hooks/useExpenseLabels";
import { useExpenses } from "@/hooks/useExpenses";
import { useExpenseSources } from "@/hooks/useExpenseSources";
import { useHousehold } from "@/hooks/useHousehold";
import { useNow } from "@/hooks/useNow";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { overallCap } from "@/lib/expenseExport";
import {
  barPercent,
  BUDGET_ID,
  budgetLines,
  hasOwnExpenses,
  monthBalance,
  monthExpenses,
  monthIncomes,
  monthKey,
  monthStart,
  monthTotals,
  shiftMonth,
  type Budget,
  type BudgetLine,
  type ExpenseRecord,
  type ManualExpense,
} from "@/lib/expenses";
import { formatAriary, formatMonthYear } from "@/lib/format";
import { rise, stagger } from "@/lib/motion";

const tabs = ["month", "income", "recurring", "history", "budget"] as const;
type Tab = (typeof tabs)[number];
const isTab = (value: unknown): value is Tab => typeof value === "string" && (tabs as readonly string[]).includes(value);
const isMonth = (value: unknown): value is string => typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
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
  // "?month=2026-10&tab=income&focus=<key>": a line shown from where it comes from.
  const askedMonth = isMonth(router.query.month) ? router.query.month : null;
  const askedTab = isTab(router.query.tab) ? router.query.tab : null;
  const focus = typeof router.query.focus === "string" ? router.query.focus : null;
  const [picked, setPicked] = useState<string | null>(null);
  const month = opened ? monthKey(opened.at) : (picked ?? askedMonth ?? current);
  const [chosenTab, setTab] = useState<Tab | null>(null);
  const tab: Tab = opened ? "month" : (chosenTab ?? askedTab ?? "month");
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
    const incomes = monthIncomes(records, month, sources);
    return {
      items,
      incomes,
      balance: monthBalance(items, incomes),
      previousTotal: monthTotals(monthExpenses(records, sources, shiftMonth(month, -1))).total,
      budgetRecord: budget,
      budget: budgetLines(budget, totals),
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

      <Welcome />

      <motion.div variants={rise} className={styles.viewSwitch}>
        <SegmentedControl
          ariaLabel={t("expenses.views.label")}
          value={view}
          onChange={pickView}
          options={[
            { value: "personal", label: t("expenses.views.personal"), icon: <User /> },
            { value: "household", label: t("expenses.views.household"), icon: <Users /> },
          ]}
        />
        <p className={styles.hint}>{t("expenses.views.hint")}</p>
      </motion.div>

      <MonthPicker month={month} onPick={pickMonth} />

      {view === "household" ? (
        <motion.div variants={rise}>
          <HouseholdPanel month={month} records={records} canCreate canMove joinCode={joinCode} />
        </motion.div>
      ) : (
        <>
          <motion.div variants={rise}>
            <MonthCard balance={figures.balance} budget={figures.budget} records={records} />
          </motion.div>

          <motion.div variants={rise} className={styles.tabs}>
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
            <p className={styles.tabHint} data-testid="expenses-tab-hint">
              {t(`expenses.tabHints.${tab}`)}
            </p>
          </motion.div>

          <motion.div variants={rise}>
            {tab === "month" ? (
              <div className={styles.panel}>
                <MonthPanel
                  key={`${month}:${opened?.id ?? ""}:${focus ?? ""}`}
                  share={share}
                  month={month}
                  initialEditing={opened}
                  onEdited={closeOpened}
                  records={records}
                  items={figures.items}
                  incomes={figures.incomes}
                  budget={figures.budgetRecord}
                  budgetLines={figures.budget}
                  previousTotal={figures.previousTotal}
                  focus={focus}
                />
                {/* Keyed by month: a review asked for another month never shows under this one. */}
                <MonthReview key={month} month={month} records={records} sources={sources} />
              </div>
            ) : tab === "income" ? (
              <IncomePanel key={`${month}:${focus ?? ""}`} month={month} incomes={figures.incomes} defaultAt={defaultAt} focus={focus} />
            ) : tab === "recurring" ? (
              <RecurringPanel month={month} records={records} canRemind={canRemind} />
            ) : tab === "history" ? (
              <HistoryPanel month={month} records={records} sources={sources} />
            ) : (
              <BudgetPanel records={records} lines={figures.budget} />
            )}
          </motion.div>
        </>
      )}
    </motion.div>
  );
}

/** "Il te reste…": the month at a glance, above every tab, with the budget and its warnings. */
function MonthCard({ balance, budget, records }: { balance: ReturnType<typeof monthBalance>; budget: BudgetLine[]; records: ExpenseRecord[] }) {
  const { t, locale } = useTranslation();
  const { categoryName } = useExpenseLabels(records);
  const money = (value: number) => formatAriary(value, locale);
  const cap = overallCap(budget);
  const ratio = cap ? balance.spent / cap : 0;
  const level = cap ? (balance.spent > cap ? "over" : ratio >= 0.8 ? "warning" : "ok") : undefined;
  const worst = budget.find((line) => line.level === "over") ?? budget.find((line) => line.level === "warning");
  const scopeName = (scope: string) => (scope === "total" ? t("expenses.budget.overall") : categoryName(scope));

  return (
    <section className={styles.monthCard} aria-label={t("expenses.card.label")}>
      <small>{t("expenses.card.left")}</small>
      <strong className={styles.left} data-tone={balance.left < 0 ? "bad" : undefined} data-testid="expenses-left">
        {money(balance.left)}
      </strong>
      <p className={styles.flows}>
        <span>
          {t("expenses.card.in")} <strong data-testid="expenses-in">{money(balance.earned)}</strong>
        </span>
        <span aria-hidden>·</span>
        <span>
          {t("expenses.card.out")} <strong data-testid="expenses-total">{money(balance.spent)}</strong>
        </span>
      </p>
      {cap !== null && (
        <div className={styles.cardBudget}>
          <span className={styles.track} data-level={level}>
            <span style={{ width: `${barPercent(ratio)}%` }} />
          </span>
          <small>{t("expenses.card.ofBudget", { percent: Math.round(ratio * 100), cap: money(cap) })}</small>
        </div>
      )}
      {worst && (
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
    </section>
  );
}

/** The first visit: what to do, in 3 steps, until closed (remembered on the device, read once mounted). */
function Welcome() {
  const { t } = useTranslation();
  const [closed, close] = useDismissed("expenses.welcome");
  if (closed) return null;
  return (
    <section className={styles.welcome} aria-labelledby="expenses-welcome">
      <div className={styles.welcomeHead}>
        <h2 id="expenses-welcome">{t("expenses.welcome.title")}</h2>
        <button type="button" className={styles.close} onClick={close} aria-label={t("expenses.close")}>
          <X size={18} />
        </button>
      </div>
      <p>{t("expenses.welcome.auto")}</p>
      <ol>
        <li>{t("expenses.welcome.step1")}</li>
        <li>{t("expenses.welcome.step2")}</li>
        <li>{t("expenses.welcome.step3")}</li>
      </ol>
    </section>
  );
}
