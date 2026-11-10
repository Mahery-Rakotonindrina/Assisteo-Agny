import { useState } from "react";
import { CalendarCheck, X } from "lucide-react";
import { Button } from "@/components/Button";
import { useDismissed } from "@/hooks/useDismissed";
import { useNow } from "@/hooks/useNow";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { useWeekLines, useWeekSummary } from "@/hooks/useWeekSummary";
import { isSummaryDay, summaryIsEmpty, weekStart } from "@/lib/weeklySummary";
import { useSettings } from "@/lib/settings/SettingsProvider";
import styles from "./WeekCard.module.scss";

/**
 * "Ta semaine", on Sundays, on the home screen (below the scan): the same
 * summary as the notification of the app. Reminders' rules: Lite and up, and
 * it can be switched off in Settings.
 */
export function WeekCard() {
  const { settings, ready } = useSettings();
  const { has } = usePlan();
  const now = useNow(60_000);
  if (!ready || !settings.weeklySummary || !has("reminders") || !isSummaryDay(now)) return null;
  return <Card />;
}

function Card() {
  const { t } = useTranslation();
  // The end of today, fixed when the card appears: the summary is worked out once, then when the data change (not every minute).
  const [at] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime() - 1;
  });
  const summary = useWeekSummary(at);
  const lines = useWeekLines(summary);
  // Closed for this week only.
  const [closed, close] = useDismissed(`weekly.${weekStart(at)}`);
  if (closed || summaryIsEmpty(summary)) return null;

  return (
    <section className={styles.card} aria-labelledby="week-card" data-testid="week-card">
      <div className={styles.head}>
        <strong id="week-card">
          <CalendarCheck size={18} aria-hidden /> {t("weekly.title")}
        </strong>
        <Button variant="ghost" size="icon" icon={<X />} aria-label={t("weekly.close")} onClick={close} />
      </div>
      <ul>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}
