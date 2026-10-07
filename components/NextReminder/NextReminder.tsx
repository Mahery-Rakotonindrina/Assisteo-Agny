import Link from "next/link";
import { BellRing, ChevronRight, Lock } from "lucide-react";
import { useNow } from "@/hooks/useNow";
import { useTranslation } from "@/hooks/useTranslation";
import { formatReminder } from "@/lib/format";
import { isForced } from "@/services/reminders";
import type { HistoryEntry } from "@/types/history";
import styles from "./NextReminder.module.scss";

/** The soonest upcoming reminder, on the home screen. Renders nothing when there is none. */
export function NextReminder({ entries }: { entries: HistoryEntry[] }) {
  const { t, locale } = useTranslation();
  const now = useNow(30_000);
  const upcoming = entries
    .filter((entry) => entry.reminderAt && entry.reminderAt > now)
    .sort((a, b) => a.reminderAt! - b.reminderAt!);
  const next = upcoming[0];
  if (!next) return null;

  const forced = isForced(next);
  const others = upcoming.length - 1;

  return (
    <Link href={{ pathname: "/result", query: { id: next.id } }} className={styles.card}>
      <span className={styles.icon} aria-hidden>
        {forced ? <Lock /> : <BellRing />}
      </span>
      <span className={styles.text}>
        <small>{t("home.nextReminder")}</small>
        <strong>{next.analysis.reminder?.title ?? next.analysis.title}</strong>
        <span className={styles.when}>
          {formatReminder(next.reminderAt!, now, locale)}
          {others > 0 && <span className={styles.others}> · {t("home.otherReminders", { count: others })}</span>}
        </span>
      </span>
      <ChevronRight size={18} className={styles.chevron} />
    </Link>
  );
}
