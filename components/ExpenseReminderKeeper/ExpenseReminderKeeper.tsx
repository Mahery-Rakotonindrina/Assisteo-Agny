import { useEffect, useRef } from "react";
import { useExpenseLabels } from "@/hooks/useExpenseLabels";
import { useExpenseReminderTexts } from "@/hooks/useExpenseReminderTexts";
import { useExpenses } from "@/hooks/useExpenses";
import { useExpenseSources } from "@/hooks/useExpenseSources";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { BUDGET_ID, budgetLines, monthExpenses, monthKey, monthTotals, type Budget } from "@/lib/expenses";
import { useSettings } from "@/lib/settings/SettingsProvider";
import { reconcileEvenings, useEveningSetting } from "@/services/eveningReminder";
import { notifyBudgetAlerts, reconcileExpenseReminders } from "@/services/expenseReminders";

/**
 * Keeps the "Mes dépenses" notifications in line with the recurring expenses
 * and the plan: due dates (the day before or the day itself), and the budget
 * alerts, the tontines' payments and the evening reminder. Without the plan,
 * the due dates and evenings are cancelled, and come back with it.
 */
export function ExpenseReminderKeeper() {
  const { ready } = useSettings();
  const { plan, has } = usePlan();
  // Unknown until the plan is read once (cache or server): nothing is cancelled meanwhile.
  const known = plan !== null;
  const enabled = has("expenses") && has("reminders");
  const { records } = useExpenses();
  const texts = useExpenseReminderTexts();

  useEffect(() => {
    if (!ready || !known) return;
    const timer = setTimeout(() => void reconcileExpenseReminders(records, texts.due, enabled), 1200);
    return () => clearTimeout(timer);
  }, [ready, known, enabled, records, texts]);

  // The next 7 evenings, again at each change (an expense noted skips its evening).
  const evening = useEveningSetting();
  useEffect(() => {
    if (!ready || !known) return;
    const timer = setTimeout(() => void reconcileEvenings(records, evening, texts.evening, enabled), 1500);
    return () => clearTimeout(timer);
  }, [ready, known, enabled, records, evening, texts]);

  // The sources (history, lists, parcels, garage) are only read with the plan.
  return ready && enabled ? <BudgetAlerts /> : null;
}

/** Notifies once a month each cap reaching 80 %, then going over (whatever the expense came from). */
function BudgetAlerts() {
  const { records, isLoading } = useExpenses();
  const sources = useExpenseSources();
  const texts = useExpenseReminderTexts();
  const { t } = useTranslation();
  const { categoryName } = useExpenseLabels(records);
  const latest = useRef({ texts, categoryName, t });

  useEffect(() => {
    latest.current = { texts, categoryName, t };
  }, [texts, categoryName, t]);

  useEffect(() => {
    if (isLoading) return;
    const timer = setTimeout(() => {
      const month = monthKey(Date.now());
      const budget = records.find((record): record is Budget => record.kind === "budget" && record.id === BUDGET_ID);
      if (!budget) return;
      const lines = budgetLines(budget, monthTotals(monthExpenses(records, sources, month)));
      const { texts: current, categoryName: name, t: translate } = latest.current;
      void notifyBudgetAlerts(month, lines, (line) => current.budget(line, line.scope === "total" ? translate("expenses.budget.overall") : name(line.scope)));
    }, 2000);
    return () => clearTimeout(timer);
  }, [records, sources, isLoading]);

  return null;
}
