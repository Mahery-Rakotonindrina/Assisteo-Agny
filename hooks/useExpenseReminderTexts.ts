import { useCallback, useMemo } from "react";
import type { BudgetLine } from "@/lib/expenses";
import { formatAriary, formatDate } from "@/lib/format";
import type { ExpenseAlert } from "@/services/expenseReminders";
import { useTranslation } from "./useTranslation";

/** What a "Mes dépenses" notification says: a due date, a tontine's payment, the budget reaching its cap, or the evening reminder. */
export function useExpenseReminderTexts() {
  const { t, locale } = useTranslation();
  const due = useCallback(
    (alert: ExpenseAlert) =>
      "tontine" in alert
        ? {
            title: t("expenses.savings.reminderTitle", { name: alert.tontine.name }),
            body: t("expenses.reminders.body", { amount: formatAriary(alert.tontine.amountMga, locale), date: formatDate(alert.dueAt, locale) }),
          }
        : {
            title: t(alert.recurring.remind === "eve" ? "expenses.reminders.eveTitle" : "expenses.reminders.dayTitle", { label: alert.recurring.label }),
            body: t("expenses.reminders.body", { amount: formatAriary(alert.recurring.amountMga, locale), date: formatDate(alert.dueAt, locale) }),
          },
    [t, locale],
  );
  const budget = useCallback(
    (line: BudgetLine, scope: string) => ({
      title: t(line.level === "over" ? "expenses.reminders.overTitle" : "expenses.reminders.warningTitle", { scope }),
      body: t("expenses.reminders.budgetBody", { spent: formatAriary(line.spent, locale), cap: formatAriary(line.cap, locale) }),
    }),
    [t, locale],
  );
  const evening = useMemo(() => ({ title: t("expenses.evening.title"), body: t("expenses.evening.body") }), [t]);
  return { due, budget, evening };
}
