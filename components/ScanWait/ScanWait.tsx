import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { Lightbulb, Timer } from "lucide-react";
import { useNow } from "@/hooks/useNow";
import { useTranslation } from "@/hooks/useTranslation";
import type { ScanMode } from "@/lib/ai/schema";
import { easeOut } from "@/lib/motion";
import styles from "./ScanWait.module.scss";

/** After this long, say that the AI is slower than usual (it is often overloaded). */
const SLOW_AFTER_S = 20;
const TIP_EVERY_MS = 5000;

type ScanWaitProps = {
  mode: ScanMode;
  modeIcon: ReactNode;
  startedAt: number;
};

/** What the analysis screen shows under the photo while the AI works. */
export function ScanWait({ mode, modeIcon, startedAt }: ScanWaitProps) {
  const { t, list } = useTranslation();
  const now = useNow(1000);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const tips = list(`scan.tips.${mode}`);
  const [tip, setTip] = useState(0);

  useEffect(() => {
    if (tips.length < 2) return;
    const timer = setInterval(() => setTip((current) => (current + 1) % tips.length), TIP_EVERY_MS);
    return () => clearInterval(timer);
  }, [tips.length]);

  return (
    <motion.div
      className={styles.wait}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.4, ease: easeOut }}
    >
      <div className={styles.meta}>
        <span className={styles.chip}>
          {modeIcon}
          {t(`scan.modes.${mode}`)}
        </span>
        <span className={styles.chip} aria-label={t("scan.elapsed", { seconds })}>
          <Timer />
          <span className={styles.seconds}>{seconds} s</span>
        </span>
      </div>

      {seconds >= SLOW_AFTER_S && <p className={styles.slow}>{t("scan.slow")}</p>}

      {tips.length > 0 && (
        <div className={styles.tip}>
          <Lightbulb className={styles.tipIcon} />
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={tip}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25, ease: easeOut }}
            >
              {tips[tip % tips.length]}
            </motion.p>
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
}
