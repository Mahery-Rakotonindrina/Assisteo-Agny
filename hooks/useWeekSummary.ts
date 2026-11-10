import { useMemo } from "react";
import { monthExpenses, monthKey } from "@/lib/expenses";
import { weekStart, weekSummary, type WeekSummary } from "@/lib/weeklySummary";
import { formatAriary } from "@/lib/format";
import { useExpenses } from "./useExpenses";
import { useBudgetSources, useExpenseSources } from "./useExpenseSources";
import { useHistory } from "./useHistory";
import { useParcels } from "./useParcels";
import { usePlan } from "./usePlan";
import { useTranslation } from "./useTranslation";

/**
 * The week that ends at `at`, from what is on this device (spending only with
 * "Mes dépenses"). Reads a lot of stores: mount it only where it is needed.
 */
export function useWeekSummary(at: number, upcomingFrom?: number): WeekSummary {
  const { has } = usePlan();
  const withExpenses = has("expenses");
  const { records } = useExpenses();
  const sources = useBudgetSources(records, useExpenseSources());
  const { parcels } = useParcels();
  const { entries } = useHistory();

  return useMemo(() => {
    // A week can straddle two months.
    const months = [...new Set([monthKey(weekStart(at)), monthKey(at)])];
    const spending = withExpenses ? months.flatMap((month) => monthExpenses(records, sources, month)) : null;
    const reminders = entries.flatMap((entry) => (typeof entry.reminderAt === "number" ? [entry.reminderAt] : []));
    return weekSummary({ at, spending, parcels, reminders, upcomingFrom });
  }, [at, upcomingFrom, withExpenses, records, sources, parcels, entries]);
}

/** What the summary says, one sentence per thing worth saying. */
export function useWeekLines(summary: WeekSummary): string[] {
  const { t, locale } = useTranslation();
  const lines: string[] = [];
  if (summary.spentMga) lines.push(t("weekly.spent", { amount: formatAriary(summary.spentMga, locale) }));
  if (summary.arrived > 0) lines.push(t(summary.arrived === 1 ? "weekly.arrived.one" : "weekly.arrived.other", { count: summary.arrived }));
  if (summary.upcoming > 0) lines.push(t(summary.upcoming === 1 ? "weekly.upcoming.one" : "weekly.upcoming.other", { count: summary.upcoming }));
  return lines;
}
