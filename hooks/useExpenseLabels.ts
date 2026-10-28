import { useCallback, useMemo } from "react";
import { byKind, categoryColors, expenseCategories, type BuiltInCategory, type ExpenseRecord } from "@/lib/expenses";
import { useTranslation } from "./useTranslation";

const isBuiltIn = (category: string): category is BuiltInCategory => (expenseCategories as readonly string[]).includes(category);

/** The categories to choose from (built-in, then the user's own), and how each one reads. */
export function useExpenseLabels(records: ExpenseRecord[]) {
  const { t } = useTranslation();
  const custom = useMemo(() => byKind(records, "category").sort((a, b) => a.createdAt - b.createdAt), [records]);

  const categories = useMemo(
    () => [
      ...expenseCategories.map((id) => ({ id, name: t(`expenses.categories.${id}`), color: categoryColors[id], custom: false, icon: undefined })),
      ...custom.map((category) => ({ id: category.id, name: category.name, color: category.color, custom: true, icon: category.icon })),
    ],
    [custom, t],
  );

  const categoryName = useCallback(
    (category: string) => (isBuiltIn(category) ? t(`expenses.categories.${category}`) : (custom.find((item) => item.id === category)?.name ?? t("expenses.categories.other"))),
    [custom, t],
  );
  const categoryColor = useCallback(
    (category: string) => (isBuiltIn(category) ? categoryColors[category] : (custom.find((item) => item.id === category)?.color ?? categoryColors.other)),
    [custom],
  );

  return { categories, custom, categoryName, categoryColor };
}
