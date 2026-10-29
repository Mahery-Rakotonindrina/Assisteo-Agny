import {
  ACTIVITY_ID,
  byKind,
  isForResale,
  monthExpenses,
  monthIncomes,
  monthKey,
  saleKey,
  soldOn,
  type ExpenseRecord,
  type IncomeItem,
  type MonthItem,
  type SourceItem,
} from "@/lib/expenses";
import { clientSummaries } from "@/lib/parcelReport";
import { parcelDueMga, parcelProfitMga, parcelTotalMga, type Parcel } from "@/services/parcelStore";

// Resellers: their activity (parcels bought to resell, and sold) kept apart
// from the home budget, when they ask for it. Off by default: the
// parcels then count as before (the cost an expense, the sale an income).
// The pockets never change: what was paid and received is real money.

export { isForResale };

/** Whether the reselling is kept apart from the household's budget (off when never set). */
export function separatesActivity(records: ExpenseRecord[]) {
  return byKind(records, "activity").some((record) => record.id === ACTIVITY_ID && record.separate);
}

/** The month's "Profit from my activity" line: its key, for "don't count". */
export const activityKey = (month: string) => `activity:${month}`;

/** The key of a parcel's cost line (its sale's is saleKey). */
export const costKey = (parcelId: string) => `parcel:${parcelId}`;

/** The lines kept out by the user ("don't count"): a sale left out leaves the profit, a cost left out is not taken from it. */
export const excludedKeys = (records: ExpenseRecord[]) => new Set(byKind(records, "exclusion").map((record) => record.sourceKey));

/**
 * What the budget counts from elsewhere in the app. Kept apart,
 * the parcels to resell (their cost and their sale) leave it, and one income
 * per month comes in instead: the sales minus what the parcels sold cost,
 * only when it is above zero. The pockets keep reading every line
 * (walletBook gets the sources as they are).
 */
export function budgetSources(sources: SourceItem[], separate: boolean, excluded: Set<string> = new Set()): SourceItem[] {
  if (!separate) return sources;
  const kept = sources.filter((source) => !source.resale);
  const profits = new Map<string, { amountMga: number; at: number }>();
  for (const source of sources) {
    if (!source.resale || source.origin !== "sale" || excluded.has(source.key)) continue;
    const month = monthKey(source.at);
    const current = profits.get(month) ?? { amountMga: 0, at: source.at };
    const cost = excluded.has(costKey(source.key.slice("sale:".length))) ? 0 : source.amountMga - (source.profitMga ?? 0);
    profits.set(month, { amountMga: current.amountMga + source.amountMga - cost, at: Math.max(current.at, source.at) });
  }
  for (const [month, profit] of profits) {
    if (profit.amountMga <= 0) continue;
    kept.push({ key: activityKey(month), flow: "income", origin: "activity", at: profit.at, amountMga: profit.amountMga, category: "sales", href: "/parcels" });
  }
  return kept;
}

export type TopClient = { name: string; salesMga: number; profitMga: number; parcels: number };

export type ActivityMonth = {
  /** At least one parcel to resell, ever: the line in "Il te reste" is shown. */
  active: boolean;
  /** The parcels to resell added this month, and what they cost (the stock bought). */
  bought: number;
  boughtMga: number;
  /** The parcels sold this month, their sale prices, and those minus what they cost. */
  sold: number;
  salesMga: number;
  profitMga: number;
  /** What the clients still owe, whenever they bought. */
  toCollectMga: number;
  /** The parcels to resell not sold yet, and what they cost. */
  stock: number;
  stockMga: number;
  /** The month's best clients by sales, 3 at most. */
  topClients: TopClient[];
};

const sold = (parcel: Pick<Parcel, "salePriceMga">) => Boolean(parcel.salePriceMga && parcel.salePriceMga > 0);

/**
 * "Mon activité" for a month: bought, sold, profit, still to collect, stock
 * and the best clients. The lines left out ("don't count") are left out here
 * too, like in the month's profit line.
 */
export function activityMonth(parcels: Parcel[], month: string, excluded: Set<string> = new Set()): ActivityMonth {
  const resale = parcels.filter((parcel) => !parcel.deletedAt && isForResale(parcel));
  // A cost left out costs nothing in the profit.
  const counted = resale.map((parcel) => (excluded.has(costKey(parcel.id)) ? { ...parcel, priceMga: 0, fees: [] } : parcel));
  const bought = counted.filter((parcel) => monthKey(parcel.createdAt) === month && !excluded.has(costKey(parcel.id)));
  const soldThen = counted.filter((parcel) => sold(parcel) && monthKey(soldOn(parcel)) === month && !excluded.has(saleKey(parcel.id)));
  const stock = resale.filter((parcel) => !sold(parcel));
  const topClients = clientSummaries(soldThen)
    .filter((summary): summary is typeof summary & { name: string } => summary.name !== null)
    .map((summary) => ({ name: summary.name, salesMga: summary.totalMga + summary.profitMga, profitMga: summary.profitMga, parcels: summary.parcels }))
    .sort((a, b) => b.salesMga - a.salesMga || a.name.localeCompare(b.name))
    .slice(0, 3);
  return {
    active: resale.length > 0,
    bought: bought.length,
    boughtMga: bought.reduce((total, parcel) => total + parcelTotalMga(parcel), 0),
    sold: soldThen.length,
    salesMga: soldThen.reduce((total, parcel) => total + (parcel.salePriceMga ?? 0), 0),
    profitMga: soldThen.reduce((total, parcel) => total + (parcelProfitMga(parcel) ?? 0), 0),
    toCollectMga: resale.reduce((total, parcel) => total + parcelDueMga(parcel), 0),
    stock: stock.length,
    stockMga: stock.reduce((total, parcel) => total + parcelTotalMga(parcel), 0),
    topClients,
  };
}

/** One of the month's lines of the activity: a purchase (expense) or a sale (income), as the month's lists show them. */
export type ActivityLine = { flow: "expense"; item: MonthItem } | { flow: "income"; item: IncomeItem };

/**
 * The month's purchases and sales of parcels to resell, the latest first,
 * shown in "Mon activité" once it is kept apart (they are not in the
 * month's lists then): each picks its pocket and can be left out.
 */
export function activityLines(records: ExpenseRecord[], sources: SourceItem[], month: string): ActivityLine[] {
  const resale = sources.filter((source) => source.resale);
  const lines: ActivityLine[] = [
    ...monthExpenses(records, resale, month).map((item) => ({ flow: "expense" as const, item })),
    ...monthIncomes(records, month, resale).map((item) => ({ flow: "income" as const, item })),
  ];
  return lines.sort((a, b) => b.item.at - a.item.at || a.item.key.localeCompare(b.item.key));
}
