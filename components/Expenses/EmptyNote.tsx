import type { ReactNode } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import styles from "./Expenses.module.scss";

/** An empty tab: an icon, what it is for, and an example. `texts` holds title, body and example. */
export function EmptyNote({ icon, texts }: { icon: ReactNode; texts: string }) {
  const { t } = useTranslation();
  return (
    <div className={styles.emptyNote}>
      <span className={styles.emptyIcon} aria-hidden>
        {icon}
      </span>
      <strong>{t(`${texts}.title`)}</strong>
      <p>{t(`${texts}.body`)}</p>
      <p className={styles.hint}>{t(`${texts}.example`)}</p>
    </div>
  );
}
