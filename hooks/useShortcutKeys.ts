import { useInHousehold } from "@/hooks/useHousehold";
import { useKeptExpenses } from "@/hooks/useExpenses";
import { useKeptLoans } from "@/hooks/useLoans";
import { usePlan } from "@/hooks/usePlan";
import { useNow } from "@/hooks/useNow";
import { listBills } from "@/lib/bills";
import { availableShortcuts } from "@/lib/homeShortcuts";
import type { HistoryEntry } from "@/types/history";

/** The home shortcuts this plan and these data allow today, in the default order. */
export function useShortcutKeys(entries: HistoryEntry[]) {
  const now = useNow(60_000);
  const { has } = usePlan();
  const inHousehold = useInHousehold();
  // Without the feature, one's kept expenses and loans stay reachable (read only); false until mounted.
  const keptExpenses = useKeptExpenses(!has("expenses"));
  const keptLoans = useKeptLoans(!has("loans"));
  const hasBills = listBills(entries, now).length > 0;
  return availableShortcuts({ has, hasBills, inHousehold, keptExpenses, keptLoans });
}
