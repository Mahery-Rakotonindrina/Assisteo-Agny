import { whatsappLink } from "@/lib/loans";

// "Ma boutique" (Pro): a small shopkeeper's book. The day's sales (product,
// quantity, price, paid or on credit for a customer), the stock with a low
// alert, the customers' credit, the totals of the day and the month. Pure, so
// it can be tested; stored by services/shopStore.ts. There is no purchase
// price anywhere: nothing here can show a margin to a customer.

type Base = { id: string; createdAt: number; updatedAt: number; deletedAt?: number; dirty?: boolean };

export type ShopProduct = Base & {
  kind: "product";
  name: string;
  /** In stock now (never below 0). */
  stock: number;
  /** The alert shows at or below this quantity. */
  lowAt: number;
  /** The usual selling price, in ariary, offered when selling it. */
  priceMga?: number;
};

export type ShopSale = Base & {
  kind: "sale";
  at: number;
  /** The product sold, when it is in the stock list (its name stays here if it is later removed). */
  productId?: string;
  name: string;
  qty: number;
  unitPriceMga: number;
  /** Paid at the sale; the rest is on credit and needs a customer. */
  paidMga: number;
  customer?: string;
  /** Where to send a reminder (WhatsApp). */
  phone?: string;
  /** What was really taken off the stock (less than `qty` when the stock was short): what goes back if the sale is removed. */
  stockTaken?: number;
};

/** Money received later from a customer, against what they owe. */
export type ShopPayment = Base & {
  kind: "payment";
  at: number;
  customer: string;
  amountMga: number;
  /** Which sales it paid, oldest first. A sale removed takes its part of the payment with it. */
  applied?: Array<{ saleId: string; amountMga: number }>;
};

export type ShopRecord = ShopProduct | ShopSale | ShopPayment;

export const DEFAULT_LOW_STOCK = 3;
export const MAX_QTY = 100_000;
export const MAX_AMOUNT = 1_000_000_000;

export const byKind = <K extends ShopRecord["kind"]>(records: ShopRecord[], kind: K) => records.filter((record): record is Extract<ShopRecord, { kind: K }> => record.kind === kind && !record.deletedAt);

/** A quantity: a positive number, up to 2 decimals (2.5 kg), else null. */
export function cleanQty(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value) || value <= 0 || value > MAX_QTY) return null;
  return Math.round(value * 100) / 100;
}

/** A whole number of ariary, 0 or more, else null. */
export function cleanMoney(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value) || value < 0 || value > MAX_AMOUNT) return null;
  return Math.round(value);
}

/** What a payment counts for: its parts on the sales still there (all of it for a payment that doesn't say which sales). */
export function paymentAmount(payment: ShopPayment, liveSales: ReadonlySet<string>) {
  return payment.applied ? payment.applied.reduce((sum, part) => sum + (liveSales.has(part.saleId) ? part.amountMga : 0), 0) : payment.amountMga;
}

export const saleTotal = (sale: Pick<ShopSale, "qty" | "unitPriceMga">) => Math.round(sale.qty * sale.unitPriceMga);

/** What is still owed on a sale (0 once paid). */
export const saleRest = (sale: Pick<ShopSale, "qty" | "unitPriceMga" | "paidMga">) => Math.max(0, saleTotal(sale) - sale.paidMga);

/** "Rado ", "rado" and "Radó" are the same customer. */
export const customerKey = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

// ---- Totals ----------------------------------------------------------------------

export const dayStart = (at: number) => {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

export const monthStart = (at: number) => {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
};

export type ShopTotals = {
  /** Number of sales. */
  sales: number;
  /** Sold, in ariary. */
  soldMga: number;
  /** Cashed in: paid at the sale, and the customers' payments received. */
  collectedMga: number;
  /** Left on credit by these sales. */
  creditMga: number;
};

/** The totals of the sales and payments between `from` (included) and `to` (excluded). */
export function shopTotals(records: ShopRecord[], from: number, to: number): ShopTotals {
  const totals: ShopTotals = { sales: 0, soldMga: 0, collectedMga: 0, creditMga: 0 };
  for (const sale of byKind(records, "sale")) {
    if (sale.at < from || sale.at >= to) continue;
    totals.sales += 1;
    totals.soldMga += saleTotal(sale);
    totals.collectedMga += Math.min(sale.paidMga, saleTotal(sale));
    totals.creditMga += saleRest(sale);
  }
  const live = new Set(byKind(records, "sale").map((sale) => sale.id));
  for (const payment of byKind(records, "payment")) if (payment.at >= from && payment.at < to) totals.collectedMga += paymentAmount(payment, live);
  return totals;
}

/** Today's and the month's totals. */
export function dayAndMonth(records: ShopRecord[], now: number) {
  const end = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate() + 1).getTime();
  const nextMonth = new Date(new Date(now).getFullYear(), new Date(now).getMonth() + 1, 1).getTime();
  return { day: shopTotals(records, dayStart(now), end), month: shopTotals(records, monthStart(now), nextMonth) };
}

/** The sales of a day, newest first. */
export const salesOfDay = (records: ShopRecord[], now: number) => {
  const from = dayStart(now);
  const to = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate() + 1).getTime();
  return byKind(records, "sale")
    .filter((sale) => sale.at >= from && sale.at < to)
    .sort((a, b) => b.at - a.at);
};

// ---- Stock -----------------------------------------------------------------------

export const isLow = (product: Pick<ShopProduct, "stock" | "lowAt">) => product.stock <= product.lowAt;

/** The products to restock, the emptiest first. */
export const lowStock = (records: ShopRecord[]) => byKind(records, "product").filter(isLow).sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name));

// ---- Customers' credit -----------------------------------------------------------

export type CustomerDebt = { key: string; name: string; owedMga: number; phone?: string; lastAt: number };

/** What is left to pay on each sale (after the payments that went to it). */
function remainingBySale(records: ShopRecord[]) {
  const paid = new Map<string, number>();
  for (const payment of byKind(records, "payment")) for (const part of payment.applied ?? []) paid.set(part.saleId, (paid.get(part.saleId) ?? 0) + part.amountMga);
  return new Map(byKind(records, "sale").map((sale) => [sale.id, Math.max(0, saleRest(sale) - (paid.get(sale.id) ?? 0))]));
}

/**
 * Who owes how much: what is left on their sales, after the payments that
 * went to them. A sale removed takes its payments with it. Only those who
 * still owe, the most first.
 */
export function customerDebts(records: ShopRecord[]): CustomerDebt[] {
  const debts = new Map<string, CustomerDebt>();
  const remaining = remainingBySale(records);
  const entry = (name: string) => {
    const key = customerKey(name);
    let debt = debts.get(key);
    if (!debt) {
      debt = { key, name: name.trim(), owedMga: 0, lastAt: 0 };
      debts.set(key, debt);
    }
    return debt;
  };
  for (const sale of [...byKind(records, "sale")].sort((a, b) => a.at - b.at)) {
    const left = remaining.get(sale.id) ?? 0;
    if (!sale.customer || left === 0) continue;
    const debt = entry(sale.customer);
    debt.owedMga += left;
    debt.lastAt = Math.max(debt.lastAt, sale.at);
    // The newest name spelling and number win.
    debt.name = sale.customer.trim();
    if (sale.phone) debt.phone = sale.phone;
  }
  // A payment that doesn't say which sales it paid (kept as a whole) comes off the customer's total.
  for (const payment of byKind(records, "payment")) {
    const debt = payment.applied ? undefined : debts.get(customerKey(payment.customer));
    if (debt) debt.owedMga -= payment.amountMga;
  }
  return [...debts.values()].filter((debt) => debt.owedMga > 0).sort((a, b) => b.owedMga - a.owedMga || a.name.localeCompare(b.name));
}

/** Which sales a payment from this customer pays: the oldest first, each up to what it still lacks. */
export function allocatePayment(records: ShopRecord[], customer: string, amountMga: number) {
  const remaining = remainingBySale(records);
  const applied: Array<{ saleId: string; amountMga: number }> = [];
  let left = amountMga;
  for (const sale of [...byKind(records, "sale")].sort((a, b) => a.at - b.at)) {
    if (left <= 0) break;
    if (!sale.customer || customerKey(sale.customer) !== customerKey(customer)) continue;
    const take = Math.min(left, remaining.get(sale.id) ?? 0);
    if (take > 0) {
      applied.push({ saleId: sale.id, amountMga: take });
      left -= take;
    }
  }
  return applied;
}

export const totalOwed = (debts: CustomerDebt[]) => debts.reduce((sum, debt) => sum + debt.owedMga, 0);

/**
 * "Relancer sur WhatsApp": the chat with the message written, to the
 * customer's number when it is known and usable, else the chat picker. The
 * message holds the name and the amount owed, nothing else.
 */
export function reminderLink(phone: string | undefined, message: string) {
  return whatsappLink(phone, message) ?? `https://wa.me/?text=${encodeURIComponent(message)}`;
}
