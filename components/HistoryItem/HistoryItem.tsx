import Link from "next/link";
import { animate, motion, useMotionValue, useTransform, type PanInfo } from "motion/react";
import { useRef } from "react";
import { BellRing, ChevronRight, Folder, Lock, Star, Trash2 } from "lucide-react";
import { categoryIcons } from "@/components/CategoryBadge";
import { useNow } from "@/hooks/useNow";
import { useTranslation } from "@/hooks/useTranslation";
import { formatReminder, formatTime } from "@/lib/format";
import { spring } from "@/lib/motion";
import { haptics } from "@/services/device";
import { isForced } from "@/services/reminders";
import type { HistoryEntry } from "@/types/history";
import styles from "./HistoryItem.module.scss";

type HistoryItemProps = {
  entry: HistoryEntry;
  /** Enables delete: swipe left on rows, hover button on tiles. */
  onDelete?: (entry: HistoryEntry) => void;
  /** "row" for phone lists, "tile" for desktop grids. */
  variant?: "row" | "tile";
};

const DELETE_THRESHOLD = -110;

export function HistoryItem({ entry, onDelete, variant = "row" }: HistoryItemProps) {
  const { locale, t } = useTranslation();
  const now = useNow();
  const x = useMotionValue(0);
  const dragged = useRef(false);
  const revealOpacity = useTransform(x, [-140, -30, 0], [1, 0.4, 0]);
  const iconScale = useTransform(x, [DELETE_THRESHOLD - 20, DELETE_THRESHOLD, 0], [1.2, 1, 0.6]);
  const { category, title, summary } = entry.analysis;
  const Icon = categoryIcons[category];
  const reminderAt = entry.reminderAt && entry.reminderAt > now ? entry.reminderAt : null;
  // Insurance notices are automatic: a lock tells them apart from the user's own reminders.
  const forced = reminderAt !== null && isForced(entry);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < DELETE_THRESHOLD && onDelete) {
      haptics.press();
      void animate(x, -480, { duration: 0.2 });
      onDelete(entry);
    } else {
      void animate(x, 0, spring);
    }
  };

  const card = (
    <Link
      href={{ pathname: "/result", query: { id: entry.id } }}
      className={`${styles.card} ${variant === "tile" ? styles.tile : ""}`}
      draggable={false}
      onClick={(event) => {
        // A swipe ends with a click; don't navigate in that case.
        if (dragged.current) event.preventDefault();
      }}
      style={{ "--cat": `var(--cat-${category})` } as React.CSSProperties}
    >
      <span className={styles.thumb}>
        {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
        <img src={entry.thumbnail} alt="" draggable={false} />
        <span className={styles.catIcon}>
          <Icon size={12} strokeWidth={2.4} />
        </span>
      </span>
      <span className={styles.body}>
        <span className={styles.title}>{title}</span>
        <span className={styles.summary}>{summary}</span>
        {entry.folder && (
          <span className={styles.folder}>
            <Folder size={12} strokeWidth={2.4} />
            {entry.folder}
          </span>
        )}
        {reminderAt !== null && (
          <span className={styles.reminder} aria-label={t("history.reminderOn", { date: formatReminder(reminderAt, now, locale) })}>
            {forced ? <Lock size={12} strokeWidth={2.4} /> : <BellRing size={12} strokeWidth={2.4} />}
            {formatReminder(reminderAt, now, locale)}
          </span>
        )}
      </span>
      <span className={styles.meta}>
        <span className={styles.time}>{formatTime(entry.createdAt, locale)}</span>
        {entry.favorite && <Star size={14} className={styles.star} fill="currentColor" aria-label={t("folders.favorite")} />}
        <ChevronRight size={16} className={styles.chevron} />
      </span>
    </Link>
  );

  if (!onDelete) return <div className={styles.item}>{card}</div>;

  if (variant === "tile") {
    return (
      <div className={`${styles.item} ${styles.tileItem}`}>
        {card}
        <button
          type="button"
          className={styles.tileDelete}
          aria-label={t("result.delete")}
          onClick={() => {
            haptics.press();
            onDelete(entry);
          }}
        >
          <Trash2 size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className={styles.item}>
      <motion.div className={styles.reveal} style={{ opacity: revealOpacity }} aria-hidden>
        <motion.span style={{ scale: iconScale }}>
          <Trash2 size={20} />
        </motion.span>
      </motion.div>
      <motion.div
        className={styles.draggable}
        style={{ x }}
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0.9, right: 0.05 }}
        onDragStart={() => {
          dragged.current = true;
        }}
        onDragEnd={(event, info) => {
          handleDragEnd(event, info);
          // Reset after the click that follows pointerup has been handled.
          setTimeout(() => {
            dragged.current = false;
          }, 0);
        }}
      >
        {card}
      </motion.div>
    </div>
  );
}
