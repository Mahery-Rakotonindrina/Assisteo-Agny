import Link from "next/link";
import { useState } from "react";
import { AlarmClock, BellRing } from "lucide-react";
import { useToast } from "@/components/Toast";
import { useReminderTexts } from "@/hooks/useReminderTexts";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDateTime } from "@/lib/format";
import { SNOOZE_CHOICES, type SnoozeChoice } from "@/lib/reminderRepeat";
import { haptics } from "@/services/device";
import { snoozeReminder } from "@/services/reminders";
import type { HistoryEntry } from "@/types/history";
import styles from "./ReminderSnooze.module.scss";

type ReminderSnoozeProps = {
  entry: HistoryEntry;
  /** Show the scan's name, linking to it (home screen). */
  linked?: boolean;
  onSnoozed?: (at: number) => void;
};

const labels: Record<SnoozeChoice, string> = { hour: "reminders.snoozeHour", tomorrow: "reminders.snoozeTomorrow", week: "reminders.snoozeWeek" };

/** A reminder that has come: "remind me later", in an hour, tomorrow or in a week. */
export function ReminderSnooze({ entry, linked = false, onSnoozed }: ReminderSnoozeProps) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const texts = useReminderTexts();
  const [busy, setBusy] = useState(false);
  const title = entry.analysis.reminder?.title ?? entry.analysis.title;

  const snooze = async (choice: SnoozeChoice) => {
    haptics.tap();
    setBusy(true);
    try {
      const at = await snoozeReminder(entry, choice, texts.other(entry));
      if (at === null) {
        haptics.error();
        toast(t("result.reminderDenied"), "error");
        return;
      }
      haptics.success();
      toast(t("result.reminderSet", { date: formatDateTime(at, locale) }));
      onSnoozed?.(at);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.card} aria-labelledby={`snooze-${entry.id}`}>
      <div className={styles.head}>
        <span className={styles.icon} aria-hidden>
          <BellRing />
        </span>
        <span className={styles.text}>
          <small id={`snooze-${entry.id}`}>{t("reminders.arrived")}</small>
          {linked ? (
            <Link href={{ pathname: "/result", query: { id: entry.id } }} className={styles.title}>
              {title}
            </Link>
          ) : (
            <strong className={styles.title}>{title}</strong>
          )}
        </span>
      </div>
      <p className={styles.label}>
        <AlarmClock size={15} /> {t("reminders.snoozeLater")}
      </p>
      <div className={styles.choices}>
        {SNOOZE_CHOICES.map((choice) => (
          <button key={choice} type="button" className={styles.choice} disabled={busy} onClick={() => void snooze(choice)}>
            {t(labels[choice])}
          </button>
        ))}
      </div>
    </section>
  );
}
