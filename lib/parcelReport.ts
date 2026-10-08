import { eventTime } from "@/lib/parcels";
import { parcelDueMga, parcelProfitMga, parcelTotalMga, type Parcel } from "@/services/parcelStore";

// Reseller tools (Pro): what each client's parcels cost, over a period.

export const periods = ["month", "lastMonth", "all", "custom"] as const;
export type Period = (typeof periods)[number];

/** Chosen days, both included ("custom" period): "2026-10-01". */
export type DayRange = { from: string; to: string };

const dayStart = (day: string) => {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date).getTime();
};

/** Whether the range runs forward (from on or before to). */
export const isValidRange = (range: DayRange) => Boolean(range.from && range.to) && range.from <= range.to;

/** When a parcel counts in a period: its order date, else when it was added. */
export function parcelDate(parcel: Pick<Parcel, "info" | "createdAt">) {
  return eventTime(parcel.info.orderedAt) ?? parcel.createdAt;
}

/** Local month of a time: "2026-10". */
const monthOf = (time: number) => {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

export function inPeriod(parcel: Pick<Parcel, "info" | "createdAt">, period: Period, now: number, range?: DayRange) {
  if (period === "all") return true;
  if (period === "custom") {
    if (!range || !isValidRange(range)) return false;
    const time = parcelDate(parcel);
    // The last day counts whole.
    return time >= dayStart(range.from) && time < dayStart(range.to) + 24 * 3600 * 1000;
  }
  const date = new Date(now);
  const target = period === "month" ? now : new Date(date.getFullYear(), date.getMonth() - 1, 1).getTime();
  return monthOf(parcelDate(parcel)) === monthOf(target);
}

export type ClientSummary = {
  /** Null for the parcels without a client. */
  name: string | null;
  parcels: number;
  ongoing: number;
  totalMga: number;
  /** Resellers: what the client still owes, and the profit on the parcels sold. */
  dueMga: number;
  profitMga: number;
  /** Parcels with a sale price. */
  sold: number;
};

/** One line per client (and one for parcels without a client), the biggest spenders first. */
export function clientSummaries(parcels: Parcel[]): ClientSummary[] {
  const byClient = new Map<string, ClientSummary>();
  for (const parcel of parcels) {
    const name = parcel.client?.trim() || null;
    // Same client whatever the case: "rado" and "Rado".
    const key = name?.toLocaleLowerCase() ?? "";
    const summary = byClient.get(key) ?? { name, parcels: 0, ongoing: 0, totalMga: 0, dueMga: 0, profitMga: 0, sold: 0 };
    summary.parcels += 1;
    if (!parcel.receivedAt) summary.ongoing += 1;
    summary.totalMga += parcelTotalMga(parcel);
    summary.dueMga += parcelDueMga(parcel);
    const profit = parcelProfitMga(parcel);
    if (profit !== null) {
      summary.profitMga += profit;
      summary.sold += 1;
    }
    byClient.set(key, summary);
  }
  return [...byClient.values()].sort(
    (a, b) => Number(a.name === null) - Number(b.name === null) || b.totalMga - a.totalMga || (a.name ?? "").localeCompare(b.name ?? ""),
  );
}

/** Whether a parcel belongs to a client picked in the summary (null: those without one). */
export function isForClient(parcel: Pick<Parcel, "client">, client: string | null) {
  const name = parcel.client?.trim() || null;
  return client === null ? name === null : name?.toLocaleLowerCase() === client.toLocaleLowerCase();
}
