import { useCallback } from "react";
import { formatDay } from "@/lib/format";
import { expiryDate, INSURANCE_NOTICE_DAYS, reminderText } from "@/services/reminders";
import type { HistoryEntry } from "@/types/history";
import { useTranslation } from "./useTranslation";

/** Notification texts for an entry's reminder, in the user's language. */
export function useReminderTexts() {
  const { t, locale } = useTranslation();

  const insurance = useCallback(
    (entry: HistoryEntry) => {
      const expiry = expiryDate(entry.analysis);
      return {
        title: t("reminders.insuranceTitle", { name: entry.analysis.title }),
        body: t("reminders.insuranceBody", {
          date: expiry ? formatDay(expiry, locale) : "",
          days: INSURANCE_NOTICE_DAYS,
        }),
      };
    },
    [locale, t],
  );

  const other = useCallback((entry: HistoryEntry) => reminderText(entry, t("reminders.defaultBody")), [t]);

  return { insurance, other };
}
