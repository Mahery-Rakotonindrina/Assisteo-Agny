import { Apple, Box, FileText, Leaf, Shapes } from "lucide-react";
import type { Category } from "@/lib/ai/schema";
import { useTranslation } from "@/hooks/useTranslation";
import styles from "./CategoryBadge.module.scss";

export const categoryIcons = {
  food: Apple,
  document: FileText,
  object: Box,
  plant: Leaf,
  other: Shapes,
} satisfies Record<Category, unknown>;

type CategoryBadgeProps = {
  category: Category;
  variant?: "soft" | "glass";
  className?: string;
};

export function CategoryBadge({ category, variant = "soft", className }: CategoryBadgeProps) {
  const { t } = useTranslation();
  const Icon = categoryIcons[category];

  return (
    <span
      className={[styles.badge, styles[variant], className].filter(Boolean).join(" ")}
      style={{ "--cat": `var(--cat-${category})` } as React.CSSProperties}
    >
      <Icon size={14} strokeWidth={2.2} />
      {t(`categories.${category}`)}
    </span>
  );
}
