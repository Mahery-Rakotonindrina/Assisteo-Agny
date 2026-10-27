import Link from "next/link";
import { BellRing, ChevronRight, Lock } from "lucide-react";
import { ReminderSnooze } from "@/components/ReminderSnooze";
import { useNow } from "@/hooks/useNow";
import { useTranslation } from "@/hooks/useTranslation";
import { formatReminder } from "@/lib/format";
import { arrivedAt, isForced } from "@/services/reminders";
import type { HistoryEntry } from "@/types/history";
import styles from "./NextReminder.module.scss";

/**
 * The soonest upcoming reminder, on the home screen, and above it the latest
 * one that has come (to put it off). Renders nothing when there is none.
 */
export function NextReminder({ entries }: { entries: HistoryEntry[] }) {
  const { t, locale } = useTranslation();
  const now = useNow(30_000);
  const upcoming = entries
    .filter((entry) => entry.reminderAt && entry.reminderAt > now)
    .sort((a, b) => a.reminderAt! - b.reminderAt!);
  const next = upcoming[0];
  const arrived = entries
    .map((entry) => ({ entry, at: arrivedAt(entry, now) }))
    .filter(({ at }) => at !== null)
    .sort((a, b) => b.at! - a.at!)[0]?.entry;
  if (!next && !arrived) return null;
  if (!next) return <ReminderSnooze entry={arrived} linked />;

  const forced = isForced(next);
  const others = upcoming.length - 1;

  const card = (
    <Link href={{ pathname: "/result", query: { id: next.id } }} className={styles.card}>
      <span className={styles.icon} aria-hidden>
        {forced ? <Lock /> : <BellRing />}
      </span>
      <span className={styles.text}>
        <small>{t("home.nextReminder")}</small>
        <strong>{next.analysis.reminder?.title ?? next.analysis.title}</strong>
        <span className={styles.when}>
          {formatReminder(next.reminderAt!, now, locale)}
          {next.reminderRepeat && <> · {t(next.reminderRepeat.every === "monthly" ? "reminders.repeatMonthly" : "reminders.repeatYearly")}</>}
          {others > 0 && <span className={styles.others}> · {t("home.otherReminders", { count: others })}</span>}
        </span>
      </span>
      <ChevronRight size={18} className={styles.chevron} />
    </Link>
  );
  if (!arrived) return card;
  return (
    <div className={styles.stack}>
      <ReminderSnooze entry={arrived} linked />
      {card}
    </div>
  );
}
