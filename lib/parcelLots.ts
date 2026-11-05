import type { ShippingMode } from "@/lib/ai/schema";

// Reseller tools (Pro): freight by the kilo and parcels grouped by shipment.
//
// Both live on the parcels themselves (no table of their own), so they sync
// with "Mes colis" and an older app keeps them as they are:
// - the freight (weight × the forwarder's rate) is also written as one fee,
//   so every total, the profit and the exports count it, even in an older app;
// - a shipment is a copy of its name, mode and departure day on each of its
//   parcels. A shipment without parcels is gone.

/** Freight charged by the kilo by a forwarder. */
export type ParcelFreight = {
  /** The forwarder's name, as typed: their rate is remembered under it. */
  forwarder?: string;
  weightKg: number;
  /** Ariary per kilo. */
  rateMga: number;
  /**
   * How the parcel travelled when the rate was typed: a forwarder has a sea
   * rate and an air rate. Missing (typed before, or mode unknown): the rate
   * stands for both.
   */
  mode?: ShippingMode;
};

/** A shipment (a lot, a container) some parcels travel in. */
export type ParcelLot = {
  id: string;
  name: string;
  mode?: ShippingMode;
  /** Departure day, "YYYY-MM-DD". */
  departedAt?: string;
};

type Fee = { id: string; label: string; amountMga: number };

/** The id of the fee that holds the freight by the kilo. */
export const FREIGHT_FEE_ID = "freight-kg";

/** Weight × rate, rounded to the ariary; 0 when either is missing. */
export function freightMga(freight: Pick<ParcelFreight, "weightKg" | "rateMga"> | null | undefined) {
  if (!freight || !(freight.weightKg > 0) || !(freight.rateMga > 0)) return 0;
  return Math.round(freight.weightKg * freight.rateMga);
}

export const isFreightFee = (fee: Pick<Fee, "id">) => fee.id === FREIGHT_FEE_ID;

/**
 * The fees with the freight fee replaced by this freight's (first in the
 * list), or removed when there is no freight to count.
 */
export function withFreightFee<T extends Fee>(fees: T[], freight: ParcelFreight | null | undefined, label: string): Fee[] {
  const others = fees.filter((fee) => !isFreightFee(fee));
  const amountMga = freightMga(freight);
  return amountMga > 0 ? [{ id: FREIGHT_FEE_ID, label, amountMga }, ...others] : others;
}

const sameName = (a: string | undefined, b: string | undefined) =>
  Boolean(a?.trim()) && a!.trim().toLocaleLowerCase() === (b ?? "").trim().toLocaleLowerCase();

type WithFreight = { freight?: ParcelFreight; updatedAt: number };

/**
 * The rate last used with this forwarder for this mode (the most recently
 * updated parcel), or null. A rate kept without a mode stands for both
 * modes, when none was kept for this one. Without a mode, the last rate.
 */
export function rememberedRate(parcels: WithFreight[], forwarder: string | undefined, mode?: ShippingMode | null) {
  const rates = parcels
    .filter((parcel) => parcel.freight && parcel.freight.rateMga > 0 && sameName(parcel.freight.forwarder, forwarder))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((parcel) => parcel.freight!);
  const last = mode ? (rates.find((rate) => rate.mode === mode) ?? rates.find((rate) => !rate.mode)) : rates[0];
  return last ? last.rateMga : null;
}

/** How a parcel's freight is charged: its shipment's mode first, then its own. */
export function freightMode(parcel: { lot?: ParcelLot }, ownMode: ShippingMode | null) {
  return parcel.lot?.mode ?? ownMode ?? undefined;
}

/** The forwarders already typed, the most recently used first, each once. */
export function knownForwarders(parcels: WithFreight[]) {
  const names: string[] = [];
  for (const parcel of [...parcels].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const name = parcel.freight?.forwarder?.trim();
    if (name && !names.some((known) => sameName(known, name))) names.push(name);
  }
  return names;
}

/** "2,5" or "2.5" → 2.5; 0 when unreadable. Weights are kept to the gram. */
export function parseWeight(value: string) {
  const number = Number(value.replace(",", ".").replace(/[^\d.]/g, ""));
  return Number.isFinite(number) && number > 0 ? Math.round(number * 1000) / 1000 : 0;
}

type Groupable = WithFreight & {
  id: string;
  lot?: ParcelLot;
  fees?: Fee[];
  salePriceMga?: number;
  paidMga?: number;
  receivedAt?: number;
};

export type LotSummary<T> = {
  lot: ParcelLot;
  parcels: T[];
  /** Parcels not yet in the user's hands. */
  ongoing: number;
  weightKg: number;
  freightMga: number;
  /** What the clients paid and still owe for these parcels (sale prices only). */
  paidMga: number;
  dueMga: number;
};

/**
 * The shipments and their totals, the latest departure first (those without
 * a day last, by name). A shipment's details are those of its most recently
 * updated parcel (they are all rewritten together).
 */
export function lotSummaries<T extends Groupable>(parcels: T[]): LotSummary<T>[] {
  const groups = new Map<string, T[]>();
  for (const parcel of parcels) {
    if (!parcel.lot?.id) continue;
    groups.set(parcel.lot.id, [...(groups.get(parcel.lot.id) ?? []), parcel]);
  }
  return [...groups.values()]
    .map((members) => {
      const lot = [...members].sort((a, b) => b.updatedAt - a.updatedAt)[0].lot!;
      const sold = members.filter((parcel) => parcel.salePriceMga);
      return {
        lot,
        parcels: members,
        ongoing: members.filter((parcel) => !parcel.receivedAt).length,
        weightKg: Math.round(members.reduce((total, parcel) => total + (parcel.freight?.weightKg ?? 0), 0) * 1000) / 1000,
        freightMga: members.reduce((total, parcel) => total + (parcel.fees ?? []).filter(isFreightFee).reduce((sum, fee) => sum + (fee.amountMga || 0), 0), 0),
        paidMga: sold.reduce((total, parcel) => total + (parcel.paidMga ?? 0), 0),
        dueMga: sold.reduce((total, parcel) => total + Math.max(0, parcel.salePriceMga! - (parcel.paidMga ?? 0)), 0),
      };
    })
    .sort((a, b) => (b.lot.departedAt ?? "").localeCompare(a.lot.departedAt ?? "") || a.lot.name.localeCompare(b.lot.name));
}
