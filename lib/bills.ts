import type { Analysis, BillKind } from "@/lib/ai/schema";
import { startOfDay } from "@/lib/format";
import { parseDay } from "@/lib/papers";

// "Mes factures": the bills read on document scans (JIRAMA, phone, rent…),
// their amount in ariary and whether they are paid, to follow spending.

type Expense = { amountMga?: number; paidAt?: number; hidden?: boolean };
type Billish = { id: string; createdAt: number; analysis: Pick<Analysis, "document" | "title">; expense?: Expense };

export type BillStatus = "paid" | "overdue" | "due";

export type Bill<T extends Billish = Billish> = {
  entry: T;
  kind: BillKind;
  issuer: string | null;
  /** In ariary; null when the bill is in another currency or unreadable, until the user types it. */
  amountMga: number | null;
  /** The amount as printed when it isn't in ariary, e.g. "84.2 EUR". */
  foreignAmount: string | null;
  dueAt: number | null;
  paidAt: number | null;
  status: BillStatus;
  /** The month it counts in: paid, else due, else scanned. */
  month: number;
};

const isAriary = (currency: string | null) => !currency || /^(MGA|AR|ARIARY)$/i.test(currency.trim());

export function startOfMonth(timestamp: number) {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

/** The bill a scan holds, if followed: read by the AI, or added by the user. */
export function billOf<T extends Billish>(entry: T, now: number): Bill<T> | null {
  const read = entry.analysis.document?.bill ?? null;
  if (entry.expense?.hidden || (!read && !entry.expense)) return null;
  const readMga = read && read.amount !== null && isAriary(read.currency) ? Math.round(read.amount) : null;
  const dueAt = parseDay(read?.dueDate) ?? parseDay(entry.analysis.document?.expiresOn);
  const paidAt = entry.expense?.paidAt ?? null;
  return {
    entry,
    kind: read?.kind ?? "other",
    issuer: read?.issuer ?? null,
    amountMga: entry.expense?.amountMga ?? readMga,
    foreignAmount: read && read.amount !== null && !isAriary(read.currency) ? `${read.amount} ${read.currency}` : null,
    dueAt,
    paidAt,
    status: paidAt ? "paid" : dueAt !== null && dueAt < startOfDay(now) ? "overdue" : "due",
    month: startOfMonth(paidAt ?? dueAt ?? entry.createdAt),
  };
}

const statusOrder: Record<BillStatus, number> = { overdue: 0, due: 1, paid: 2 };

/** Every followed bill: overdue and due first (soonest first), then the paid ones (latest first). */
export function listBills<T extends Billish>(entries: T[], now: number): Bill<T>[] {
  return entries
    .map((entry) => billOf(entry, now))
    .filter((bill) => bill !== null)
    .sort(
      (a, b) =>
        statusOrder[a.status] - statusOrder[b.status] ||
        (a.status === "paid" ? (b.paidAt ?? 0) - (a.paidAt ?? 0) : (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || b.entry.createdAt - a.entry.createdAt),
    );
}

const sumOf = (bills: Bill[]) => bills.reduce((total, bill) => total + (bill.amountMga ?? 0), 0);

/** The month's spending, and what is still to pay overall (in ariary). */
export function billTotals(bills: Bill[], now: number) {
  const month = startOfMonth(now);
  return {
    thisMonth: sumOf(bills.filter((bill) => bill.month === month)),
    toPay: sumOf(bills.filter((bill) => bill.status !== "paid")),
    unpriced: bills.filter((bill) => bill.amountMga === null).length,
  };
}

/** Spending per month over the last `count` months, the oldest first. */
export function monthlySpending(bills: Bill[], now: number, count = 6) {
  const current = new Date(startOfMonth(now));
  return Array.from({ length: count }, (_, index) => {
    const month = new Date(current.getFullYear(), current.getMonth() - (count - 1 - index), 1).getTime();
    return { month, total: sumOf(bills.filter((bill) => bill.month === month)) };
  });
}

/** This month's spending by kind of bill, the largest first. */
export function spendingByKind(bills: Bill[], now: number) {
  const month = startOfMonth(now);
  const totals = new Map<BillKind, number>();
  for (const bill of bills) if (bill.month === month && bill.amountMga) totals.set(bill.kind, (totals.get(bill.kind) ?? 0) + bill.amountMga);
  return [...totals.entries()].map(([kind, total]) => ({ kind, total })).sort((a, b) => b.total - a.total);
}
