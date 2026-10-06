import { motion } from "motion/react";
import { CircleCheckBig, Lightbulb, Sparkle, TriangleAlert } from "lucide-react";
import type { Analysis } from "@/lib/ai/schema";
import { useTranslation } from "@/hooks/useTranslation";
import { easeOut } from "@/lib/motion";
import styles from "./Result.module.scss";

const kindIcons = { tip: Lightbulb, action: CircleCheckBig, warning: TriangleAlert, idea: Sparkle } as const;

export function SuggestionList({ suggestions }: { suggestions: Analysis["suggestions"] }) {
  const { t } = useTranslation();

  return (
    <ul className={styles.suggestions}>
      {suggestions.map((suggestion, index) => {
        const Icon = kindIcons[suggestion.kind];
        return (
          <motion.li
            key={`${suggestion.kind}-${index}`}
            className={styles.suggestion}
            data-kind={suggestion.kind}
            initial={{ opacity: 0, x: -12 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-20px" }}
            transition={{ duration: 0.4, ease: easeOut, delay: index * 0.07 }}
          >
            <span className={styles.suggestionIcon}>
              <Icon size={18} />
            </span>
            <div>
              <span className={styles.suggestionKind}>{t(`result.kinds.${suggestion.kind}`)}</span>
              <h3>{suggestion.title}</h3>
              <p>{suggestion.detail}</p>
            </div>
          </motion.li>
        );
      })}
    </ul>
  );
}
