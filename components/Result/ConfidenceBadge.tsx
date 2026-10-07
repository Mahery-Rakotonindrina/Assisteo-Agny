import styles from "./Result.module.scss";

export type ConfidenceLevel = "high" | "medium" | "low";

export function confidenceLevel(value: number): ConfidenceLevel {
  return value >= 0.8 ? "high" : value >= 0.55 ? "medium" : "low";
}

type ConfidenceBadgeProps = {
  value: number;
  /** Already translated: "Identification sûre", "probable", "incertaine". */
  label: string;
};

/** How sure the AI is, in words; the percentage stays available on hover. */
export function ConfidenceBadge({ value, label }: ConfidenceBadgeProps) {
  return (
    <span className={styles.confidenceBadge} data-level={confidenceLevel(value)} title={`${Math.round(value * 100)} %`}>
      <span className={styles.confidenceDot} aria-hidden />
      {label}
    </span>
  );
}
