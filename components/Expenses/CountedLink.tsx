import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useExpenses } from "@/hooks/useExpenses";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { byKind, monthKey } from "@/lib/expenses";
import { activityKey, separatesActivity } from "@/lib/resale";
import styles from "./Expenses.module.scss";

type Props = {
  /** The line's key in "Mes dépenses" (bill:…, list:…, parcel:…, sale:…). */
  sourceKey: string;
  /** When it counts: the month shown. */
  at: number;
  flow?: "expense" | "income";
  /** Said differently (the garage counts many lines). */
  label?: string;
  /** A parcel to resell (reseller tools): the month its profit counts in, once the activity is kept apart from the budget. */
  resaleAt?: number;
};

/**
 * "Counted in My expenses →" under what the expenses read from elsewhere
 * (a paid bill, a shopping list, a parcel, the garage): opens its line in
 * its month. Only with "Mes dépenses"; nothing at the first render (the plan
 * is known once mounted).
 */
export function CountedLink({ sourceKey, at, flow = "expense", label, resaleAt }: Props) {
  const { has } = usePlan();
  if (!has("expenses")) return null;
  return <Counted sourceKey={sourceKey} at={at} flow={flow} label={label} resaleAt={has("reseller") ? resaleAt : undefined} />;
}

function Counted({ sourceKey, at, flow, label, resaleAt }: Props) {
  const { t } = useTranslation();
  const { records, isLoading } = useExpenses();
  if (isLoading) return null;
  // Kept apart: the parcel counts in the month's "profit from my activity", not in the budget on its own.
  if (resaleAt !== undefined && separatesActivity(records)) {
    const month = monthKey(resaleAt);
    return (
      <Link className={styles.counted} href={{ pathname: "/expenses", query: { month, tab: "income", focus: activityKey(month) } }}>
        <span>{t("expenses.counted.activity")}</span>
        <ArrowRight size={15} aria-hidden />
      </Link>
    );
  }
  const excluded = byKind(records, "exclusion").some((record) => record.sourceKey === sourceKey);
  const text = label ?? t(excluded ? "expenses.counted.off" : flow === "income" ? "expenses.counted.income" : "expenses.counted.expense");
  return (
    <Link className={styles.counted} href={{ pathname: "/expenses", query: { month: monthKey(at), tab: flow === "income" ? "income" : "month", focus: sourceKey } }}>
      <span>{text}</span>
      <ArrowRight size={15} aria-hidden />
    </Link>
  );
}
