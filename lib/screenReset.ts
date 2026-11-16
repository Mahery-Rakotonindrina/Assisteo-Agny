import { byKind, RESET_ID, sourceItems, type ExpenseRecord, type SourceInputs, type SourceItem } from "@/lib/expenses";
import { loanProofs } from "@/lib/loanProof";
import type { Loan } from "@/lib/loans";
import { byKind as shopByKind, type ShopRecord } from "@/lib/shop";

// "Remettre à zéro" (Réglages): what each screen's reset removes, and what it
// keeps. Pure, so it can be tested; services/screenReset.ts does the removing,
// always through each store's synced removal (tombstones), never the
// household's. "Historique" keeps its own (historyStore.clear).

export const resetScreens = ["history", "expenses", "pockets", "loans", "parcels", "shop", "health"] as const;
export type ResetScreen = (typeof resetScreens)[number];

/**
 * "Dépenses et revenus": everything the screen shows but the pockets and the
 * custom categories (the expenses' list keeps using them). The pockets stay:
 * their balances are counted again without these lines.
 */
export const expenseResetKinds = ["expense", "income", "recurring", "budget", "exclusion", "savingsGoal", "tontine", "activity"] as const satisfies ReadonlyArray<ExpenseRecord["kind"]>;

/** "Mes poches": the pockets, the moves between them, the corrections and the pocket picked for a line (their order is on the pockets). */
export const pocketResetKinds = ["wallet", "transfer", "correction", "walletPick"] as const satisfies ReadonlyArray<ExpenseRecord["kind"]>;

const inKinds = (kinds: ReadonlyArray<string>) => (record: ExpenseRecord) => !record.deletedAt && kinds.includes(record.kind);

/** The ids an "expenses" or "pockets" reset removes from "Mes dépenses". */
export function expenseResetIds(records: ExpenseRecord[], screen: "expenses" | "pockets") {
  return records.filter(inKinds(screen === "expenses" ? expenseResetKinds : pocketResetKinds)).map((record) => record.id);
}

export type ExpenseResetCounts = { expenses: number; incomes: number; recurring: number; savings: number; budget: boolean };

/** What the "expenses" reset window lists. */
export function expenseResetCounts(records: ExpenseRecord[]): ExpenseResetCounts {
  return {
    expenses: byKind(records, "expense").length,
    incomes: byKind(records, "income").length,
    recurring: byKind(records, "recurring").length,
    savings: byKind(records, "savingsGoal").length + byKind(records, "tontine").length,
    budget: byKind(records, "budget").some((budget) => Boolean(budget.total) || Object.keys(budget.categories ?? {}).length > 0),
  };
}

export type PocketResetCounts = { pockets: number; moves: number; picks: number };

/** What the "pockets" reset window lists: the pockets (archived ones too), the moves typed in and the pockets picked for a line. */
export function pocketResetCounts(records: ExpenseRecord[]): PocketResetCounts {
  return { pockets: byKind(records, "wallet").length, moves: byKind(records, "transfer").length + byKind(records, "correction").length, picks: byKind(records, "walletPick").length };
}

export type ShopResetCounts = { sales: number; products: number; payments: number };

/** What the "Ma boutique" reset window lists. */
export function shopResetCounts(records: ShopRecord[]): ShopResetCounts {
  return { sales: shopByKind(records, "sale").length, products: shopByKind(records, "product").length, payments: shopByKind(records, "payment").length };
}

export type LoanResetCounts = { loans: number; repayments: number; proofs: number };

export function loanResetCounts(loans: Loan[]): LoanResetCounts {
  const live = loans.filter((loan) => !loan.deletedAt);
  return {
    loans: live.length,
    repayments: live.reduce((sum, loan) => sum + (loan.repayments ?? []).length, 0),
    proofs: live.reduce((sum, loan) => sum + loanProofs(loan).length, 0),
  };
}

/**
 * The lines "Mes dépenses" shows from the rest of the app (receipts, bills,
 * parcels, the garage…), since the last reset: a second scan of the same
 * transaction and a move between one's own pockets are not lines of their own.
 */
export function computedLineCount(sources: SourceItem[]) {
  return sources.filter((source) => !source.sameAs && !source.own).length;
}

/** Since when "Mes dépenses" starts again (the last reset), if ever. */
export function resetSince(records: ExpenseRecord[]): number | undefined {
  const mark = byKind(records, "reset").find((record) => record.id === RESET_ID);
  return mark && Number.isFinite(mark.at) ? mark.at : undefined;
}

/**
 * The lines "Mes dépenses" takes from the rest of the app, without those from
 * before the last reset: the scans made before it (whatever the receipt's
 * date), and the other lines dated before it (a bill paid, a parcel bought, a
 * fill…). The scans, parcels and the garage keep them; only "Mes dépenses"
 * forgets them. The receipts are left out before the lines are computed, so a
 * receipt scanned again after the reset is not taken for a copy of the old one.
 */
export function sourcesSince(inputs: SourceInputs, since: number | undefined): SourceItem[] {
  if (since === undefined) return sourceItems(inputs);
  const receipts = (inputs.receipts ?? []).filter((scan) => scan.createdAt >= since);
  return sourceItems({ ...inputs, receipts }).filter((item) => item.scannedAt !== undefined || item.at >= since);
}
