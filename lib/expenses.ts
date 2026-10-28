import type { Bill } from "@/lib/bills";
import type { BillKind } from "@/lib/ai/schema";
import type { Vehicle } from "@/lib/garage";
import type { ForeignCurrency } from "@/lib/money";
import { makeRepeat, occurrence } from "@/lib/reminderRepeat";
import type { SavedList } from "@/services/listStore";
import type { Parcel } from "@/services/parcelStore";

// "Mes dépenses": the household's monthly budget. Pure, so it can be tested.
// One synced collection of records (services/expenseStore.ts), told apart by
// `kind`: expenses typed in, incomes, recurring ones (rent, school fees…), the
// budget, the user's own categories and the "not in my budget" marks. What
// the app already knows (paid bills, shopping lists, parcel costs, the
// garage) is computed here at display time, never copied.

export const expenseCategories = [
  "market",
  "jirama",
  "rent",
  "transport",
  "phone",
  "school",
  "health",
  "family",
  "online",
  "car",
  "leisure",
  "savings",
  "other",
] as const;
export type BuiltInCategory = (typeof expenseCategories)[number];

/** Colours of the built-in categories (bars, dots). */
export const categoryColors: Record<BuiltInCategory, string> = {
  market: "#2e9e5b",
  jirama: "#e0a020",
  rent: "#7b5cd6",
  transport: "#2f80c8",
  phone: "#18a3a3",
  school: "#d9622b",
  health: "#d64560",
  family: "#c4579f",
  online: "#8a6d3b",
  car: "#4a6fa5",
  leisure: "#a0b52e",
  savings: "#3a9d8f",
  other: "#8a8f98",
};

/** What the user picks for a category of their own. */
export const customColors = ["#2e9e5b", "#2f80c8", "#7b5cd6", "#d64560", "#e0a020", "#18a3a3", "#d9622b", "#8a8f98"];
export const customIcons = ["tag", "heart", "home", "gift", "star", "baby", "church", "plane"] as const;
export type CustomIcon = (typeof customIcons)[number];

export const paymentMethods = ["cash", "mobile", "card"] as const;
export type PaymentMethod = (typeof paymentMethods)[number];

export const incomeKinds = ["salary", "sales", "other"] as const;
export type IncomeKind = (typeof incomeKinds)[number];

/** When a recurring expense rings: never, the day before or the day itself (at 9:00). */
export const dueReminderChoices = ["none", "eve", "day"] as const;
export type DueReminder = (typeof dueReminderChoices)[number];

export const expenseCurrencies = ["MGA", "CNY", "USD", "EUR"] as const;
export type ExpenseCurrency = (typeof expenseCurrencies)[number];

/** An amount typed in yuan, dollars or euros: kept as typed, with the rate used. */
export type Converted = { currency?: ForeignCurrency; originalAmount?: number; rate?: number };

type Base = { id: string; createdAt: number; updatedAt: number; deletedAt?: number; dirty?: boolean };

export type ManualExpense = Base &
  Converted & {
    kind: "expense";
    /** The day it was paid (local midnight). */
    at: number;
    amountMga: number;
    /** A built-in category, or a custom category's id. */
    category: string;
    note?: string;
    payment?: PaymentMethod;
    /** The computed expense it stands for (a bill, a recurring occurrence…): that one is then not counted. */
    sourceKey?: string;
    /** Added from a scanned receipt: its transaction reference (no duplicates), and the scan. */
    reference?: string;
    scanId?: string;
  };

export type Income = Base & {
  kind: "income";
  at: number;
  amountMga: number;
  income: IncomeKind;
  note?: string;
  /** The recurring income's occurrence it replaces. */
  sourceKey?: string;
};

export type Recurring = Base & {
  kind: "recurring";
  flow: "expense" | "income";
  label: string;
  amountMga: number;
  /** An expense category, or an income kind. */
  category: string;
  /** Day of the month, 1 to 31 (31 falls on the last day of shorter months). */
  day: number;
  /** First month it counts in, "2026-10". */
  startMonth: string;
  /** Last month it counts in, once stopped. */
  endMonth?: string;
  payment?: PaymentMethod;
  remind: DueReminder;
  /** Months marked "not this month". */
  skipped: string[];
};

export type Budget = Base & {
  kind: "budget";
  /** Monthly cap for everything, in ariary. */
  total?: number;
  /** Monthly cap per category. */
  categories: Record<string, number>;
};

export type CustomCategory = Base & { kind: "category"; name: string; color: string; icon: CustomIcon };

/** A computed expense the user keeps out of the budget. */
export type Exclusion = Base & { kind: "exclusion"; sourceKey: string };

export type ExpenseRecord = ManualExpense | Income | Recurring | Budget | CustomCategory | Exclusion;

export const BUDGET_ID = "budget";
export const exclusionId = (sourceKey: string) => `exclusion:${sourceKey}`;

/** Expenses at 80 % of their cap warn, beyond it they are over. */
export const BUDGET_WARNING = 0.8;
export const DUE_REMINDER_HOUR = 9;

// ---- Months -----------------------------------------------------------------------

/** "2026-10", in local time. */
export function monthKey(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

const parseMonth = (key: string) => {
  const [year, month] = key.split("-").map(Number);
  return { year, month: month - 1 };
};

/** Local midnight on the 1st of the month. */
export function monthStart(key: string) {
  const { year, month } = parseMonth(key);
  return new Date(year, month, 1).getTime();
}

/** The month `count` months later (or earlier, when negative). */
export function shiftMonth(key: string, count: number) {
  const { year, month } = parseMonth(key);
  return monthKey(new Date(year, month + count, 1).getTime());
}

/** The last `count` months up to `key` included, the oldest first. */
export function lastMonths(key: string, count: number) {
  return Array.from({ length: count }, (_, index) => shiftMonth(key, index - (count - 1)));
}

const inMonth = (at: number, key: string) => at >= monthStart(key) && at < monthStart(shiftMonth(key, 1));

// ---- Recurring --------------------------------------------------------------------

/**
 * The recurring rule as a monthly repeat (lib/reminderRepeat.ts). It starts in
 * January of the first year, whose 31 days keep a "31st" on the last day of
 * shorter months (31 → 30 → 31) instead of drifting to the 30th.
 */
function repeatOf(recurring: Pick<Recurring, "day" | "startMonth">) {
  const { year } = parseMonth(recurring.startMonth);
  const day = Math.min(31, Math.max(1, Math.round(recurring.day)));
  return { repeat: makeRepeat("monthly", new Date(year, 0, day, DUE_REMINDER_HOUR).getTime()), year };
}

/**
 * When the recurring item falls in a month (9:00 local), or null when it
 * doesn't count then. The repeat gives the day; the time is set locally, so a
 * change to summer time doesn't move it.
 */
export function occurrenceIn(recurring: Pick<Recurring, "day" | "startMonth" | "endMonth">, key: string) {
  if (key < recurring.startMonth || (recurring.endMonth && key > recurring.endMonth)) return null;
  const { repeat, year } = repeatOf(recurring);
  const target = parseMonth(key);
  const wall = new Date(occurrence(repeat, (target.year - year) * 12 + target.month) + repeat.offset * 60_000);
  return new Date(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate(), DUE_REMINDER_HOUR).getTime();
}

/** The key of a recurring item's occurrence: a manual expense or income can stand for it. */
export const occurrenceKey = (recurringId: string, key: string) => `recurring:${recurringId}:${key}`;

// ---- What the app already knows -----------------------------------------------------

export type ExpenseOrigin = "manual" | "recurring" | "bill" | "shopping" | "parcel" | "fuel" | "maintenance" | "vehicle";

/** One line of a month: typed in, recurring, or read from another part of the app. */
export type MonthItem = {
  /** Unique; for computed lines, the key an exclusion or a linked manual expense refers to. */
  key: string;
  origin: ExpenseOrigin;
  at: number;
  amountMga: number;
  category: string;
  /** The bill's issuer, the list's title, the vehicle's name… */
  label?: string;
  /** Where the source is shown in the app. */
  href?: string;
  /** Kept out of the budget by the user. */
  excluded: boolean;
  record?: ManualExpense;
  recurring?: Recurring;
};

export type SourceInputs = {
  bills?: Array<Pick<Bill, "kind" | "issuer" | "amountMga" | "paidAt"> & { entry: { id: string } }>;
  lists?: Array<Pick<SavedList, "id" | "title" | "kind" | "items" | "updatedAt">>;
  parcels?: Array<Pick<Parcel, "id" | "title" | "priceMga" | "fees" | "createdAt">>;
  vehicles?: Array<Pick<Vehicle, "id" | "name" | "fuel" | "maintenance" | "expenses">>;
};

export const billCategory: Record<BillKind, BuiltInCategory> = {
  electricity_water: "jirama",
  phone_internet: "phone",
  tv: "leisure",
  rent: "rent",
  school: "school",
  health: "health",
  other: "other",
};

type Computed = Omit<MonthItem, "excluded">;

/** Every expense the app knows from elsewhere: paid bills, ticked shopping, parcel costs, the garage. */
export function sourceItems({ bills = [], lists = [], parcels = [], vehicles = [] }: SourceInputs): Computed[] {
  const items: Computed[] = [];
  for (const bill of bills) {
    if (!bill.paidAt || !bill.amountMga) continue;
    items.push({
      key: `bill:${bill.entry.id}`,
      origin: "bill",
      at: bill.paidAt,
      amountMga: bill.amountMga,
      category: billCategory[bill.kind] ?? "other",
      label: bill.issuer ?? undefined,
      href: `/result?id=${encodeURIComponent(bill.entry.id)}`,
    });
  }
  for (const list of lists) {
    if (list.kind !== "shopping") continue;
    // What was ticked, priced; counted when the list last changed.
    const spent = list.items.reduce((total, item) => total + (item.done && item.priceMga ? item.priceMga : 0), 0);
    if (spent > 0)
      items.push({ key: `list:${list.id}`, origin: "shopping", at: list.updatedAt, amountMga: spent, category: "market", label: list.title, href: `/lists?open=${encodeURIComponent(list.id)}` });
  }
  for (const parcel of parcels) {
    const total = (parcel.priceMga ?? 0) + (parcel.fees ?? []).reduce((sum, fee) => sum + (fee.amountMga || 0), 0);
    if (total > 0) items.push({ key: `parcel:${parcel.id}`, origin: "parcel", at: parcel.createdAt, amountMga: total, category: "online", label: parcel.title, href: "/parcels" });
  }
  for (const vehicle of vehicles) {
    const href = `/garage?open=${encodeURIComponent(vehicle.id)}`;
    for (const fill of vehicle.fuel ?? [])
      if (fill.amountMga) items.push({ key: `fuel:${vehicle.id}:${fill.id}`, origin: "fuel", at: fill.at, amountMga: fill.amountMga, category: "transport", label: vehicle.name, href });
    for (const entry of vehicle.maintenance ?? [])
      if (entry.costMga) items.push({ key: `maintenance:${vehicle.id}:${entry.id}`, origin: "maintenance", at: entry.at, amountMga: entry.costMga, category: "car", label: vehicle.name, href });
    for (const expense of vehicle.expenses ?? [])
      if (expense.amountMga)
        items.push({ key: `vehicle:${vehicle.id}:${expense.id}`, origin: "vehicle", at: expense.at, amountMga: expense.amountMga, category: "car", label: expense.label ?? vehicle.name, href });
  }
  return items;
}

// ---- A month ------------------------------------------------------------------------

const live = <T extends { deletedAt?: number }>(records: T[]) => records.filter((record) => !record.deletedAt);

export const byKind = <K extends ExpenseRecord["kind"]>(records: ExpenseRecord[], kind: K) =>
  live(records).filter((record): record is Extract<ExpenseRecord, { kind: K }> => record.kind === kind);

/** One's own expenses or incomes are kept (not deleted): the read-only history is worth a link. */
export const hasOwnExpenses = (records: ExpenseRecord[]) => byKind(records, "expense").length > 0 || byKind(records, "income").length > 0;

/** The keys a manual expense or income stands for: those computed lines are not counted twice. */
export function linkedKeys(records: ExpenseRecord[]) {
  const keys = new Set<string>();
  for (const record of live(records)) if ((record.kind === "expense" || record.kind === "income") && record.sourceKey) keys.add(record.sourceKey);
  return keys;
}

/**
 * The month's expenses, the latest first: typed in, the recurring ones due
 * that month (unless skipped), and what the app knows from elsewhere. A
 * computed line a manual expense stands for is left out.
 */
export function monthExpenses(records: ExpenseRecord[], sources: Computed[], key: string): MonthItem[] {
  const linked = linkedKeys(records);
  const excluded = new Set(byKind(records, "exclusion").map((record) => record.sourceKey));
  const items: MonthItem[] = byKind(records, "expense")
    .filter((record) => inMonth(record.at, key))
    .map((record) => ({ key: `manual:${record.id}`, origin: "manual", at: record.at, amountMga: record.amountMga, category: record.category, label: record.note, excluded: false, record }));

  for (const recurring of byKind(records, "recurring")) {
    if (recurring.flow !== "expense" || recurring.skipped.includes(key)) continue;
    const at = occurrenceIn(recurring, key);
    const itemKey = occurrenceKey(recurring.id, key);
    if (at === null || linked.has(itemKey)) continue;
    items.push({ key: itemKey, origin: "recurring", at, amountMga: recurring.amountMga, category: recurring.category, label: recurring.label, excluded: excluded.has(itemKey), recurring });
  }

  for (const source of sources) {
    if (!inMonth(source.at, key) || linked.has(source.key)) continue;
    items.push({ ...source, excluded: excluded.has(source.key) });
  }
  return items.sort((a, b) => b.at - a.at || a.key.localeCompare(b.key));
}

export type IncomeItem = { key: string; at: number; amountMga: number; income: IncomeKind; label?: string; record?: Income; recurring?: Recurring };

/** The month's incomes: typed in, and the recurring ones (salary…) unless skipped or replaced. */
export function monthIncomes(records: ExpenseRecord[], key: string): IncomeItem[] {
  const linked = linkedKeys(records);
  const items: IncomeItem[] = byKind(records, "income")
    .filter((record) => inMonth(record.at, key))
    .map((record) => ({ key: `manual:${record.id}`, at: record.at, amountMga: record.amountMga, income: record.income, label: record.note, record }));
  for (const recurring of byKind(records, "recurring")) {
    if (recurring.flow !== "income" || recurring.skipped.includes(key)) continue;
    const at = occurrenceIn(recurring, key);
    const itemKey = occurrenceKey(recurring.id, key);
    if (at === null || linked.has(itemKey)) continue;
    const income = (incomeKinds as readonly string[]).includes(recurring.category) ? (recurring.category as IncomeKind) : "other";
    items.push({ key: itemKey, at, amountMga: recurring.amountMga, income, label: recurring.label, recurring });
  }
  return items.sort((a, b) => b.at - a.at || a.key.localeCompare(b.key));
}

/** What the month's lines add up to (excluded ones left out), and by category, the largest first. */
export function monthTotals(items: Pick<MonthItem, "amountMga" | "category" | "excluded">[]) {
  const categories = new Map<string, number>();
  let total = 0;
  for (const item of items) {
    if (item.excluded) continue;
    total += item.amountMga;
    categories.set(item.category, (categories.get(item.category) ?? 0) + item.amountMga);
  }
  return { total, byCategory: [...categories.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount) };
}

/** This month against the last: the difference, and in percent (null when last month had nothing). */
export function compareMonths(current: number, previous: number) {
  return { difference: current - previous, percent: previous > 0 ? Math.round(((current - previous) / previous) * 100) : null };
}

// ---- Budget ---------------------------------------------------------------------------

export type BudgetLevel = "ok" | "warning" | "over";

export function budgetLevel(spent: number, cap: number | undefined): BudgetLevel | null {
  if (!cap || cap <= 0) return null;
  if (spent > cap) return "over";
  return spent >= cap * BUDGET_WARNING ? "warning" : "ok";
}

export type BudgetLine = { scope: string; spent: number; cap: number; level: BudgetLevel; ratio: number };

/** Every cap set, the overall one ("total") first, with what was spent against it. */
export function budgetLines(budget: Pick<Budget, "total" | "categories"> | undefined, totals: ReturnType<typeof monthTotals>): BudgetLine[] {
  if (!budget) return [];
  const lines: BudgetLine[] = [];
  const add = (scope: string, spent: number, cap: number | undefined) => {
    const level = budgetLevel(spent, cap);
    if (level && cap) lines.push({ scope, spent, cap, level, ratio: spent / cap });
  };
  add("total", totals.total, budget.total);
  for (const [category, cap] of Object.entries(budget.categories ?? {})) add(category, totals.byCategory.find((line) => line.category === category)?.amount ?? 0, cap);
  return lines;
}

const levelRank: Record<BudgetLevel, number> = { ok: 0, warning: 1, over: 2 };

/**
 * The alerts not yet notified this month: a cap reaching 80 %, then going
 * over. `seen` holds the level last notified per scope.
 */
export function newBudgetAlerts(lines: BudgetLine[], seen: Record<string, BudgetLevel>) {
  return lines.filter((line) => line.level !== "ok" && levelRank[line.level] > levelRank[seen[line.scope] ?? "ok"]);
}

// ---- History --------------------------------------------------------------------------

/** Totals month by month over the last `count` months (up to `key`), the oldest first, and the average per category. */
export function spendingHistory(records: ExpenseRecord[], sources: Computed[], key: string, count: number) {
  const months = lastMonths(key, count).map((month) => ({ month, ...monthTotals(monthExpenses(records, sources, month)) }));
  const sums = new Map<string, number>();
  for (const month of months) for (const line of month.byCategory) sums.set(line.category, (sums.get(line.category) ?? 0) + line.amount);
  const total = months.reduce((sum, month) => sum + month.total, 0);
  return {
    months: months.map(({ month, total: monthTotal }) => ({ month, total: monthTotal })),
    average: Math.round(total / count),
    averages: [...sums.entries()].map(([category, sum]) => ({ category, amount: Math.round(sum / count) })).sort((a, b) => b.amount - a.amount),
  };
}

// ---- Currencies ---------------------------------------------------------------------------

/** An amount in yuan, dollars or euros, in ariary at the given rate. */
export function toAriary(amount: number, rate: number) {
  return Math.round(amount * rate);
}

// ---- Due reminders -------------------------------------------------------------------------

export type DueAlert = { recurring: Recurring; month: string; dueAt: number; at: number };

/** A recurring expense's next reminder after `now` (months skipped or replaced left out), or null. */
export function nextDueReminder(recurring: Recurring, records: ExpenseRecord[], now: number): DueAlert | null {
  if (recurring.deletedAt || recurring.remind === "none" || recurring.flow !== "expense") return null;
  const linked = linkedKeys(records);
  let month = monthKey(now) < recurring.startMonth ? recurring.startMonth : monthKey(now);
  for (let step = 0; step < 14; step += 1, month = shiftMonth(month, 1)) {
    if (recurring.endMonth && month > recurring.endMonth) return null;
    const dueAt = occurrenceIn(recurring, month);
    if (dueAt === null || recurring.skipped.includes(month) || linked.has(occurrenceKey(recurring.id, month))) continue;
    const date = new Date(dueAt);
    if (recurring.remind === "eve") date.setDate(date.getDate() - 1);
    if (date.getTime() > now) return { recurring, month, dueAt, at: date.getTime() };
  }
  return null;
}
