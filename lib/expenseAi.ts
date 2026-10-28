import type { Analysis, ExpenseSummaryRequest, ReceiptPayment } from "@/lib/ai/schema";
import {
  billCategory,
  byKind,
  BUDGET_ID,
  dayStart,
  lastMonths,
  monthExpenses,
  monthIncomes,
  monthStart,
  monthTotals,
  shiftMonth,
  type Budget,
  type ExpenseRecord,
  type ManualExpense,
  type PaymentMethod,
  receiptKey,
  sameReference,
} from "@/lib/expenses";
import { currencySymbols, type ForeignCurrency } from "@/lib/money";
import { parseDay } from "@/lib/papers";

// "Mes dépenses" and the AI: a scanned receipt turned into an expense, and the
// month's totals sent for a review. Pure, so it can be tested.

type Scan = { id: string; createdAt: number; analysis: Pick<Analysis, "document"> };

const payments: Record<ReceiptPayment, PaymentMethod> = { cash: "cash", mobile_money: "mobile", card: "card" };

export { sameReference };

/**
 * The expense form's starting values for a scanned receipt: amount, day,
 * category, payment, shop, reference. A receipt that pays a bill is linked
 * to that bill, so a bill marked paid is not counted twice. Null when the
 * scan is not a receipt.
 */
export function receiptDraft(scan: Scan): Partial<ManualExpense> | null {
  const receipt = scan.analysis.document?.receipt;
  if (!receipt) return null;
  const bill = scan.analysis.document?.bill;
  const currency = receipt.currency?.trim().toUpperCase();
  const total = receipt.total !== null && receipt.total > 0 ? receipt.total : undefined;
  const ariary = !currency || currency === "MGA" || currency === "AR";
  const foreign = currency && currency in currencySymbols ? (currency as ForeignCurrency) : undefined;
  return {
    at: parseDay(receipt.date) ?? dayStart(scan.createdAt),
    ...(total !== undefined && ariary && { amountMga: Math.round(total) }),
    // Yuan, dollars or euros: the form fills in today's rate.
    ...(total !== undefined && foreign && { currency: foreign, originalAmount: total }),
    category: receipt.category ?? (bill ? billCategory[bill.kind] : undefined) ?? "other",
    payment: receipt.payment ? payments[receipt.payment] : undefined,
    note: receipt.merchant?.trim().slice(0, 200) || undefined,
    reference: receipt.reference?.trim() || undefined,
    scanId: scan.id,
    // It stands for the line counted on its own (the bill it pays, else the receipt itself).
    sourceKey: bill ? `bill:${scan.id}` : receiptKey(scan.id),
  };
}

/** The expense already added from this receipt: same transaction reference, or same scan. */
export function receiptDuplicate(records: ExpenseRecord[], scan: Scan): ManualExpense | undefined {
  const reference = scan.analysis.document?.receipt?.reference ?? undefined;
  return byKind(records, "expense").find((record) => record.scanId === scan.id || sameReference(record.reference, reference));
}

// ---- The month's review ------------------------------------------------------------------

const MAX_CATEGORIES = 20;
const AVERAGE_MONTHS = 6;

/**
 * What the month's review sends: totals for the month, the one before and
 * the average of the 6 before, overall and per category (named as the user
 * sees them). No note, shop, reference or single expense ever leaves.
 */
export function summaryRequest(
  records: ExpenseRecord[],
  sources: Parameters<typeof monthExpenses>[1],
  month: string,
  { locale, now, categoryName }: { locale: ExpenseSummaryRequest["locale"]; now: number; categoryName: (category: string) => string },
): ExpenseSummaryRequest {
  const totalsOf = (key: string) => monthTotals(monthExpenses(records, sources, key));
  const current = totalsOf(month);
  const previous = totalsOf(shiftMonth(month, -1));
  const before = lastMonths(shiftMonth(month, -1), AVERAGE_MONTHS).map(totalsOf);
  const average = (pick: (totals: ReturnType<typeof totalsOf>) => number) => Math.round(before.reduce((sum, totals) => sum + pick(totals), 0) / AVERAGE_MONTHS);
  const amountIn = (totals: ReturnType<typeof totalsOf>, category: string) => totals.byCategory.find((line) => line.category === category)?.amount ?? 0;

  const budget = byKind(records, "budget").find((record): record is Budget => record.id === BUDGET_ID);
  // Money in: typed in, recurring, parcels sold, Mobile Money received (the lines kept out left out).
  const income = monthIncomes(records, month, sources).reduce((sum, item) => sum + (item.excluded ? 0 : item.amountMga), 0);

  // This month's categories first (largest first), then the ones only seen before.
  const ids = [...new Set([...current.byCategory, ...previous.byCategory, ...before.flatMap((totals) => totals.byCategory)].map((line) => line.category))];
  const categories = ids
    .map((category) => ({
      name: (categoryName(category).trim() || "?").slice(0, 40),
      amount: amountIn(current, category),
      previous: amountIn(previous, category),
      average: average((totals) => amountIn(totals, category)),
      cap: budget?.categories?.[category] || null,
    }))
    .sort((a, b) => b.amount - a.amount || b.average - a.average)
    .slice(0, MAX_CATEGORIES);

  const start = monthStart(month);
  const end = monthStart(shiftMonth(month, 1));
  const daysInMonth = Math.round((end - start) / 86_400_000);
  const going = now >= start && now < end;
  return {
    locale,
    month,
    dayOfMonth: going ? new Date(now).getDate() : null,
    daysInMonth: Math.min(31, Math.max(28, daysInMonth)),
    total: current.total,
    previousTotal: previous.total,
    averageTotal: average((totals) => totals.total),
    income: income > 0 ? income : null,
    budget: budget?.total || null,
    categories,
  };
}

