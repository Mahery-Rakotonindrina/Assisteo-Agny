import { motion } from "motion/react";
import { useId, type ReactNode } from "react";
import { spring } from "@/lib/motion";
import { haptics } from "@/services/device";
import styles from "./Result.module.scss";

export type ResultTab = { id: string; label: string; icon: ReactNode; dot?: boolean };

type ResultTabsProps = {
  tabs: ResultTab[];
  value: string;
  onChange: (id: string) => void;
  /** Prefix for the tab and panel ids (aria-controls / aria-labelledby). */
  idPrefix: string;
  label: string;
};

/** Sticky tab strip that splits a long analysis into short pages. */
export function ResultTabs({ tabs, value, onChange, idPrefix, label }: ResultTabsProps) {
  const pillId = useId();
  return (
    <div className={styles.tabs} role="tablist" aria-label={label}>
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            id={`${idPrefix}-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={active ? 0 : -1}
            className={`${styles.tab} ${active ? styles.tabActive : ""}`}
            onClick={() => {
              if (active) return;
              haptics.tap();
              onChange(tab.id);
            }}
            onKeyDown={(event) => {
              // Arrow keys move between tabs, as screen reader users expect.
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
              const index = tabs.findIndex((item) => item.id === value);
              const next = tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
              onChange(next.id);
              document.getElementById(`${idPrefix}-tab-${next.id}`)?.focus();
            }}
          >
            {active && <motion.span layoutId={pillId} className={styles.tabPill} transition={spring} />}
            <span className={styles.tabLabel}>
              {tab.icon}
              {tab.label}
              {tab.dot && <span className={styles.tabDot} aria-hidden />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
