import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { spring } from "@/lib/motion";
import styles from "./Expenses.module.scss";

const noSubscribe = () => () => {};

type Props = { open: boolean; title: string; onClose: () => void; children: ReactNode };

/**
 * The sheet the expenses' forms open in: from the bottom on a phone, a
 * centred window on a computer (like the parcel's edit sheet).
 */
export function ExpenseSheet({ open, title, onClose, children }: Props) {
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <Sheet title={title} onClose={onClose}>
          {children}
        </Sheet>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function Sheet({ title, onClose, children }: Omit<Props, "open">) {
  const { t } = useTranslation();
  const id = useId();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <motion.div className={styles.backdrop} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={spring}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.sheetTop}>
          <h2 id={id}>{title}</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label={t("expenses.close")}>
            <X size={18} />
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}
