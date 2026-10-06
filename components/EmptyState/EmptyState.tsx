import { motion } from "motion/react";
import type { ReactNode } from "react";
import { softSpring } from "@/lib/motion";
import styles from "./EmptyState.module.scss";

type EmptyStateProps = {
  title: string;
  body: string;
  action?: ReactNode;
};

const cards = [
  { rotate: -10, x: -38, y: 10, delay: 0.1, cat: "food" },
  { rotate: 8, x: 38, y: 6, delay: 0.2, cat: "document" },
  { rotate: -2, x: 0, y: -6, delay: 0.3, cat: "plant" },
];

/** A small floating stack of "scan cards" instead of a stock illustration. */
export function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <div className={styles.art} aria-hidden>
        {cards.map((card, index) => (
          <motion.span
            key={card.cat}
            className={styles.card}
            style={{ "--cat": `var(--cat-${card.cat})` } as React.CSSProperties}
            initial={{ opacity: 0, y: 40, rotate: 0, x: 0 }}
            animate={{ opacity: 1, y: [card.y, card.y - 8, card.y], rotate: card.rotate, x: card.x }}
            transition={{
              opacity: { delay: card.delay, duration: 0.4 },
              rotate: { ...softSpring, delay: card.delay },
              x: { ...softSpring, delay: card.delay },
              y: { duration: 4 + index, repeat: Infinity, ease: "easeInOut", delay: card.delay },
            }}
          >
            <span className={styles.cardImage} />
            <span className={styles.cardLine} />
            <span className={`${styles.cardLine} ${styles.short}`} />
          </motion.span>
        ))}
      </div>
      <h2>{title}</h2>
      <p>{body}</p>
      {action}
    </div>
  );
}
