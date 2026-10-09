import Link from "next/link";
import { BookOpen, FolderLock } from "lucide-react";
import { useNow } from "@/hooks/useNow";
import { useTranslation } from "@/hooks/useTranslation";
import { journalDay, totalIntake } from "@/lib/food";
import { formatNumber } from "@/lib/format";
import { listPapers } from "@/lib/papers";
import type { HistoryEntry } from "@/types/history";
import styles from "./Shortcuts.module.scss";

/** The tools built on the scans (food journal, papers…), with what they hold today. */
export function Shortcuts({ entries }: { entries: HistoryEntry[] }) {
  const { t, locale } = useTranslation();
  const now = useNow(60_000);
  const eaten = journalDay(entries, now);
  const papers = listPapers(entries, now);
  const urgent = papers.filter((paper) => paper.status === "expired" || paper.status === "soon").length;

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
      <Link href="/papers" className={styles.shortcut} style={{ "--tone": "var(--cat-document)" } as React.CSSProperties}>
        <FolderLock size={18} />
        <span>
          <strong>{t("papers.title")}</strong>
          <small data-urgent={urgent > 0 || undefined}>
            {urgent > 0 ? t("papers.shortcutUrgent", { count: urgent }) : papers.length > 0 ? t("papers.count", { count: papers.length }) : t("shortcuts.papersHint")}
          </small>
        </span>
      </Link>
    </nav>
  );
}
