import { useMemo } from "react";
import { useLoans } from "@/hooks/useLoans";
import { usePlan } from "@/hooks/usePlan";
import type { ExpenseRecord, SourceItem } from "@/lib/expenses";
import { walletBook } from "@/lib/wallets";

/**
 * What each pocket holds, the same on every screen ("Mes dépenses", "Mes
 * poches"): every line the app knows (`useExpenseSources`, the reselling
 * included), and the loans when "Prêts" is on (lib/loanLink.ts). Every loan
 * is returned too: a pocket one of them names is never removed.
 */
export function useWalletBook(records: ExpenseRecord[], sources: SourceItem[], now: number) {
  const { has } = usePlan();
  const withLoans = has("loans");
  const { loans } = useLoans();
  const book = useMemo(() => walletBook(records, sources, now, withLoans ? loans : []), [records, sources, now, withLoans, loans]);
  return { book, loans };
}
