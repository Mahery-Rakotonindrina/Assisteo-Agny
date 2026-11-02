import { useMemo } from "react";
import { listBills } from "@/lib/bills";
import { isMine } from "@/lib/household";
import type { ExpenseRecord, SourceItem } from "@/lib/expenses";
import { budgetSources, excludedKeys, separatesActivity } from "@/lib/resale";
import { resetSince, sourcesSince } from "@/lib/screenReset";
import { useExpenses } from "./useExpenses";
import { useHistory } from "./useHistory";
import { useHousehold, useHouseholdExpenses } from "./useHousehold";
import { useLists } from "./useLists";
import { useParcels } from "./useParcels";
import { usePlan } from "./usePlan";
import { useVehicles } from "./useVehicles";

/**
 * What "Mes dépenses" takes from the rest of the app, computed each time
 * (never copied): paid bills, ticked shopping, parcel costs and sales, the
 * garage, scanned receipts (money paid or received) and the subscriptions paid.
 * Those from before "Remettre à zéro" are left out (lib/screenReset.ts).
 */
export function useExpenseSources() {
  const { entries } = useHistory();
  const since = resetSince(useExpenses().records);
  const { lists } = useLists();
  const { parcels } = useParcels();
  const { vehicles } = useVehicles();
  const { plan } = usePlan();
  const snapshot = useHousehold();
  const { expenses: shared } = useHouseholdExpenses();
  const payments = plan?.payments;
  const me = snapshot?.userId ?? null;
  return useMemo(
    // The bills' status doesn't matter here, only their payment day: any "now" does.
    () =>
      sourcesSince(
        {
          bills: listBills(entries, 0),
          lists,
          parcels,
          vehicles,
          receipts: entries,
          payments,
          // A receipt the user moved to the household counts there, not here.
          taken: shared.filter((expense) => isMine(expense, me)),
        },
        since,
      ),
    [entries, lists, parcels, vehicles, payments, shared, me, since],
  );
}

/**
 * What the budget counts of those lines: the reselling left out once the
 * user keeps it apart (reseller tools only), one "profit from my activity"
 * income per month instead. The pockets keep reading every line.
 */
export function useBudgetSources(records: ExpenseRecord[], sources: SourceItem[]) {
  const { has } = usePlan();
  const separate = has("reseller") && separatesActivity(records);
  return useMemo(() => budgetSources(sources, separate, excludedKeys(records)), [sources, separate, records]);
}
