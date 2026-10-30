import { useMemo } from "react";
import type { PocketChoice } from "@/components/Expenses/WalletChips";
import { useExpenses } from "@/hooks/useExpenses";
import { usePlan } from "@/hooks/usePlan";
import { activeWallets, walletContext } from "@/lib/wallets";

/**
 * The pockets of "Mes dépenses" a loan or a repayment can be taken from:
 * only with both "Prêts" and "Mes dépenses", and once pockets are set.
 * Undefined otherwise (the loan forms then show no pocket).
 */
export function useLoanPockets(): PocketChoice | undefined {
  const { has } = usePlan();
  const linked = has("loans") && has("expenses");
  const { records } = useExpenses();
  return useMemo(() => {
    if (!linked) return undefined;
    const context = walletContext(records);
    const wallets = activeWallets(context.wallets);
    return wallets.length > 0 ? { wallets, primary: context.primary?.id } : undefined;
  }, [linked, records]);
}
