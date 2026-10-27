import { useMemo } from "react";
import { listBills } from "@/lib/bills";
import { sourceItems } from "@/lib/expenses";
import { useHistory } from "./useHistory";
import { useLists } from "./useLists";
import { useParcels } from "./useParcels";
import { useVehicles } from "./useVehicles";

/**
 * What "Mes dépenses" takes from the rest of the app, computed each time
 * (never copied): paid bills, ticked shopping, parcel costs, the garage.
 */
export function useExpenseSources() {
  const { entries } = useHistory();
  const { lists } = useLists();
  const { parcels } = useParcels();
  const { vehicles } = useVehicles();
  return useMemo(
    // The bills' status doesn't matter here, only their payment day: any "now" does.
    () => sourceItems({ bills: listBills(entries, 0), lists, parcels, vehicles }),
    [entries, lists, parcels, vehicles],
  );
}
