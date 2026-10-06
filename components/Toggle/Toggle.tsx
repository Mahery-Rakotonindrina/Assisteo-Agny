import { motion } from "motion/react";
import { spring } from "@/lib/motion";
import { haptics } from "@/services/device";
import styles from "./Toggle.module.scss";

type ToggleProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
};

export function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`${styles.toggle} ${checked ? styles.on : ""}`}
      onClick={() => {
        haptics.tap();
        onChange(!checked);
      }}
    >
      <motion.span className={styles.thumb} layout transition={spring} />
    </button>
  );
}
