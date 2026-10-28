import { useCallback } from "react";
import type { BudgetLine, DueAlert } from "@/lib/expenses";
import { formatAriary, formatDate } from "@/lib/format";
import { useTranslation } from "./useTranslation";

/** What a "Mes dépenses" notification says: a due date, or the budget reaching its cap. */
export function useExpenseReminderTexts() {
  const { t, locale } = useTranslation();
  const due = useCallback(
    ({ recurring, dueAt }: DueAlert) => ({
      title: t(recurring.remind === "eve" ? "expenses.reminders.eveTitle" : "expenses.reminders.dayTitle", { label: recurring.label }),
      body: t("expenses.reminders.body", { amount: formatAriary(recurring.amountMga, locale), date: formatDate(dueAt, locale) }),
    }),
    [t, locale],
  );
  const budget = useCallback(
    (line: BudgetLine, scope: string) => ({
      title: t(line.level === "over" ? "expenses.reminders.overTitle" : "expenses.reminders.warningTitle", { scope }),
      body: t("expenses.reminders.budgetBody", { spent: formatAriary(line.spent, locale), cap: formatAriary(line.cap, locale) }),
    }),
    [t, locale],
  );
  return { due, budget };
}
