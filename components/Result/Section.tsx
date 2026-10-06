import { motion } from "motion/react";
import type { ReactNode } from "react";
import { rise } from "@/lib/motion";
import styles from "./Result.module.scss";

type SectionProps = {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
};

/** A titled card that rises in as part of its parent's stagger. */
export function Section({ title, icon, children }: SectionProps) {
  return (
    <motion.section variants={rise} className={styles.section}>
      <h2 className={styles.sectionTitle}>
        {icon}
        {title}
      </h2>
      {children}
    </motion.section>
  );
}
