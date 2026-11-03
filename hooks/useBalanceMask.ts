import { useCallback, useMemo } from "react";
import { useSettings } from "@/lib/settings/SettingsProvider";
import { areAllHidden, isHidden, isTotalHidden, normalizeMask, toggleAll, toggleOne } from "@/lib/balanceMask";

/**
 * Which pocket balances are hidden, kept on this device (never synced). Until
 * the stored choice is read, everything reads as hidden: the real amount
 * never flashes at opening.
 */
export function useBalanceMask() {
  const { settings, ready, update } = useSettings();
  const mask = useMemo(() => normalizeMask(settings.hiddenBalances), [settings.hiddenBalances]);
  const hidden = useCallback((id: string) => !ready || isHidden(mask, id), [ready, mask]);
  const totalHidden = useCallback((ids: string[]) => !ready || isTotalHidden(mask, ids), [ready, mask]);
  const allHidden = useCallback((ids: string[]) => ready && areAllHidden(mask, ids), [ready, mask]);
  const flipAll = useCallback((ids: string[]) => update({ hiddenBalances: toggleAll(mask, ids) }), [mask, update]);
  const flipOne = useCallback((id: string, ids: string[]) => update({ hiddenBalances: toggleOne(mask, id, ids) }), [mask, update]);
  return { hidden, totalHidden, allHidden, flipAll, flipOne };
}
