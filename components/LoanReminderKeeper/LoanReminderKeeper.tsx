import { useEffect, useMemo } from "react";
import { useLoans } from "@/hooks/useLoans";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { formatAriary } from "@/lib/format";
import type { LoanReminder } from "@/lib/loanReminders";
import { useSettings } from "@/lib/settings/SettingsProvider";
import { reconcileLoanReminders, useLoanReminderSetting } from "@/services/loanReminders";

/**
 * Keeps the due-day notifications of "Prêts" in line with the loans, the
 * setting and the plan ("Prêts" and the reminders): the day before, and the
 * day itself for money lent. Without them, or switched off, they are
 * cancelled, and come back with them.
 */
export function LoanReminderKeeper() {
  const { ready } = useSettings();
  const { plan, has } = usePlan();
  // Unknown until the plan is read once (cache or server): nothing is cancelled meanwhile.
  const known = plan !== null;
  const on = useLoanReminderSetting();
  const enabled = has("loans") && has("reminders") && on;

  useEffect(() => {
    if (!ready || !known || enabled) return;
    const timer = setTimeout(() => void reconcileLoanReminders([], () => ({ title: "", body: "" }), false), 1700);
    return () => clearTimeout(timer);
  }, [ready, known, enabled]);

  // The loans are only read with the plan and the setting.
  return ready && known && enabled ? <Scheduler /> : null;
}

function Scheduler() {
  const { t, locale } = useTranslation();
  const { loans, isLoading } = useLoans();
  const texts = useMemo(
    () => (reminder: LoanReminder) => {
      const params = { name: reminder.person, amount: formatAriary(reminder.amountMga, locale) };
      if (reminder.kind === "day") return { title: t("loans.reminders.titleDay"), body: t("loans.reminders.day", params) };
      return { title: t("loans.reminders.titleEve"), body: t(`loans.reminders.eve.${reminder.direction}`, params) };
    },
    [t, locale],
  );

  useEffect(() => {
    if (isLoading) return;
    const timer = setTimeout(() => void reconcileLoanReminders(loans, texts, true), 1700);
    return () => clearTimeout(timer);
  }, [loans, isLoading, texts]);

  return null;
}
