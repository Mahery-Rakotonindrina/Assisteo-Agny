import { motion } from "motion/react";
import { useId, type ReactNode } from "react";
import { spring } from "@/lib/motion";
import { haptics } from "@/services/device";
import styles from "./SegmentedControl.module.scss";

type Option<T extends string> = { value: T; label: ReactNode; icon?: ReactNode };

type SegmentedControlProps<T extends string> = {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  size?: "md" | "lg";
  className?: string;
};

/** A pill track whose active background glides between options. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = "md",
  className,
}: SegmentedControlProps<T>) {
  const layoutId = useId();

  return (
    <div role="radiogroup" aria-label={ariaLabel} className={[styles.track, styles[size], className].filter(Boolean).join(" ")}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={`${styles.option} ${active ? styles.active : ""}`}
            onClick={() => {
              if (active) return;
              haptics.tap();
              onChange(option.value);
            }}
          >
            {active && <motion.span layoutId={layoutId} className={styles.pill} transition={spring} />}
            <span className={styles.label}>
              {option.icon}
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
