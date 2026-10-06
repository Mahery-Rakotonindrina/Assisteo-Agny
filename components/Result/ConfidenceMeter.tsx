import { motion } from "motion/react";
import { easeOut } from "@/lib/motion";
import { CountUp } from "./CountUp";
import styles from "./Result.module.scss";

type ConfidenceMeterProps = {
  value: number;
  label: string;
};

export function ConfidenceMeter({ value, label }: ConfidenceMeterProps) {
  const percent = Math.round(value * 100);
  const level = value >= 0.75 ? "high" : value >= 0.5 ? "medium" : "low";

  return (
    <div className={styles.confidence} data-level={level}>
      <div className={styles.confidenceHead}>
        <span>{label}</span>
        <strong>
          <CountUp value={percent} />%
        </strong>
      </div>
      <div className={styles.confidenceTrack} role="meter" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <motion.span
          className={styles.confidenceFill}
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 1.1, ease: easeOut, delay: 0.2 }}
        />
      </div>
    </div>
  );
}
