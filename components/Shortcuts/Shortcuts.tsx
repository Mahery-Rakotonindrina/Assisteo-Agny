import Link from "next/link";
import { BookOpen } from "lucide-react";
import { useNow } from "@/hooks/useNow";
import { useTranslation } from "@/hooks/useTranslation";
import { journalDay, totalIntake } from "@/lib/food";
import { formatNumber } from "@/lib/format";
import type { HistoryEntry } from "@/types/history";
import styles from "./Shortcuts.module.scss";

/** The tools built on the scans (food journal…), with what they hold today. */
export function Shortcuts({ entries }: { entries: HistoryEntry[] }) {
  const { t, locale } = useTranslation();
  const now = useNow(60_000);
  const eaten = journalDay(entries, now);

  return (
    <nav className={styles.shortcuts} aria-label={t("shortcuts.label")}>
      <Link href="/food" className={styles.shortcut} style={{ "--tone": "var(--cat-food)" } as React.CSSProperties}>
        <BookOpen size={18} />
        <span>
          <strong>{t("food.title")}</strong>
          <small>
            {eaten.length > 0
              ? t("food.todayKcal", { count: formatNumber(Math.round(totalIntake(eaten).calories), locale) })
              : t("shortcuts.foodHint")}
          </small>
        </span>
      </Link>
    </nav>
  );
}
