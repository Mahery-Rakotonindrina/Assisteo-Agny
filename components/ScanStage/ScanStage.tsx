import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { easeOut, spring } from "@/lib/motion";
import styles from "./ScanStage.module.scss";

type ScanStageProps = {
  src: string;
  /** Status lines cycled while scanning. */
  steps: string[];
  scanning: boolean;
};

// Fixed "detection" points so the overlay feels like it is locking onto things.
const hotspots = [
  { x: "28%", y: "34%", delay: 0.6 },
  { x: "68%", y: "46%", delay: 1.4 },
  { x: "44%", y: "70%", delay: 2.2 },
];

export function ScanStage({ src, steps, scanning }: ScanStageProps) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!scanning || steps.length < 2) return;
    const timer = setInterval(() => setStep((current) => Math.min(current + 1, steps.length - 1)), 1700);
    return () => clearInterval(timer);
  }, [scanning, steps.length]);

  return (
    <div className={styles.stage}>
      <motion.div
        className={styles.frame}
        initial={{ opacity: 0, scale: 0.92, rotate: -1.5 }}
        animate={{ opacity: 1, scale: 1, rotate: 0 }}
        transition={spring}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- local data/blob URL */}
        <img src={src} alt="" className={styles.image} />

        {scanning && (
          <>
            <div className={styles.grid} aria-hidden />
            <motion.div
              className={styles.laser}
              aria-hidden
              initial={{ top: "0%" }}
              animate={{ top: ["0%", "100%", "0%"] }}
              transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
            />
            {hotspots.map((spot) => (
              <motion.span
                key={`${spot.x}-${spot.y}`}
                className={styles.hotspot}
                style={{ left: spot.x, top: spot.y }}
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: [0, 1, 1, 0.6], scale: [0, 1.2, 1, 1] }}
                transition={{ delay: spot.delay, duration: 0.9, ease: easeOut }}
                aria-hidden
              />
            ))}
          </>
        )}

        {(["tl", "tr", "bl", "br"] as const).map((corner, index) => (
          <motion.span
            key={corner}
            className={`${styles.corner} ${styles[corner]}`}
            initial={{ opacity: 0, scale: 1.4 }}
            animate={scanning ? { opacity: 1, scale: [1, 0.94, 1] } : { opacity: 1, scale: 1 }}
            transition={
              scanning
                ? { opacity: { delay: 0.1 + index * 0.05 }, scale: { duration: 1.8, repeat: Infinity, ease: "easeInOut" } }
                : spring
            }
            aria-hidden
          />
        ))}
      </motion.div>

      {scanning && (
        <div className={styles.status} aria-live="polite">
          <div className={styles.progress} aria-hidden>
            {steps.map((label, index) => (
              <span key={label} className={index <= step ? styles.done : undefined} />
            ))}
          </div>
          <AnimatePresence mode="wait">
            <motion.p
              key={step}
              className={styles.step}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3, ease: easeOut }}
            >
              {steps[step]}
              <span className={styles.dots} aria-hidden>
                <span />
                <span />
                <span />
              </span>
            </motion.p>
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
