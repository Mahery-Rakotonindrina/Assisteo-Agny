import type { Analysis, ParcelStatus, ShippingMode } from "@/lib/ai/schema";

// Shared parcel helpers: matching scans of the same parcel, status order and
// the public tracking link.

export type ParcelInfo = NonNullable<Analysis["parcel"]>;

/** Progress steps shown on cards; other statuses map onto them. */
export const parcelSteps = ["ordered", "shipped", "in_transit", "out_for_delivery", "delivered"] as const;

const stepOf: Record<ParcelStatus, number> = {
  ordered: 0,
  shipped: 1,
  in_transit: 2,
  out_for_delivery: 3,
  pickup_ready: 3,
  delivered: 4,
  exception: 2,
  returned: 2,
  unknown: 0,
};

export function parcelStep(status: ParcelStatus) {
  return stepOf[status];
}

/** "ok" (on its way or arrived), "done" (delivered) or "problem". */
export function parcelTone(status: ParcelStatus) {
  if (status === "delivered") return "done";
  if (status === "exception" || status === "returned") return "problem";
  return "ok";
}

const normalise = (value: string | null | undefined) => (value ?? "").replace(/[\s-]/g, "").toUpperCase();

/** Identity of a parcel across screenshots: tracking number first, else order number. */
export function parcelKeys(parcel: Pick<ParcelInfo, "trackingNumber" | "orderNumber"> | null | undefined) {
  if (!parcel) return [];
  return [normalise(parcel.trackingNumber) && `T:${normalise(parcel.trackingNumber)}`, normalise(parcel.orderNumber) && `O:${normalise(parcel.orderNumber)}`].filter(
    (key): key is string => Boolean(key),
  );
}

export function sameParcel(
  a: Pick<ParcelInfo, "trackingNumber" | "orderNumber"> | null | undefined,
  b: Pick<ParcelInfo, "trackingNumber" | "orderNumber"> | null | undefined,
) {
  const keys = new Set(parcelKeys(a));
  return parcelKeys(b).some((key) => keys.has(key));
}

/** Parses "YYYY-MM-DD HH:mm" (or a date alone) as local time; null when absent or invalid. */
export function eventTime(at: string | null | undefined) {
  const match = at?.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] ?? 0), Number(match[5] ?? 0));
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

/**
 * Whether `next` describes a later point of the journey than `current`:
 * by event time when both have one, else by progress step.
 */
export function isNewerParcel(current: ParcelInfo, next: ParcelInfo) {
  const a = eventTime(current.lastEvent?.at);
  const b = eventTime(next.lastEvent?.at);
  if (a !== null && b !== null) return b > a;
  if (next.status === current.status) return false;
  // A problem can happen at any step; otherwise only moving forward counts.
  return next.status === "exception" || next.status === "returned" || parcelStep(next.status) > parcelStep(current.status);
}

/** Order of "Mes colis" in progress: problems first, then along the journey, delivered last. */
const listRank: Record<ParcelStatus, number> = {
  exception: 0,
  returned: 1,
  unknown: 2,
  ordered: 3,
  shipped: 4,
  in_transit: 5,
  out_for_delivery: 6,
  pickup_ready: 7,
  delivered: 8,
};

type Sortable = { id: string; info: ParcelInfo; timeline: Array<{ at: number }>; createdAt: number; receivedAt?: number };

/** When the parcel last moved: the carrier's last event, else the last scan or edit. */
export function parcelActivity(parcel: Sortable) {
  return eventTime(parcel.info.lastEvent?.at) ?? parcel.timeline.at(-1)?.at ?? parcel.createdAt;
}

/**
 * Order of "Mes colis": in progress by status then latest activity first,
 * then the received ones, the last received first.
 */
export function compareParcels(a: Sortable, b: Sortable) {
  if (Boolean(a.receivedAt) !== Boolean(b.receivedAt)) return a.receivedAt ? 1 : -1;
  if (a.receivedAt && b.receivedAt && a.receivedAt !== b.receivedAt) return b.receivedAt - a.receivedAt;
  if (!a.receivedAt) {
    const byStatus = listRank[a.info.status] - listRank[b.info.status];
    if (byStatus) return byStatus;
  }
  return parcelActivity(b) - parcelActivity(a) || b.createdAt - a.createdAt || a.id.localeCompare(b.id);
}

// ---- Sea or air ---------------------------------------------------------------------
// Forwarders to Madagascar mark parcels SEA (by boat, ~45-60 days) or NORMAL
// (by plane, ~1-2 weeks), often in the tracking number or the shipping mark.

const seaWords = /\b(SEA|MARITIME|BATEAU|CONTENEUR|CONTAINER)\b|海运|海派|船运/i;
const airWords = /\b(NORMAL|AIR|AERIEN|AÉRIEN|AVION)\b|空运|空派/i;

/** "sea" or "air" when the texts say so, null when they say nothing or both. */
export function detectShippingMode(texts: Array<string | null | undefined>): ShippingMode | null {
  const text = texts.filter(Boolean).join(" | ");
  const sea = seaWords.test(text);
  const air = airWords.test(text);
  return sea === air ? null : sea ? "sea" : "air";
}

type Shippable = { shippingMode?: ShippingMode; info: ParcelInfo; timeline?: Array<{ event: ParcelInfo["lastEvent"]; statusLabel: string }> };

/**
 * How a parcel travels and how that is known: chosen by the user, read on a
 * scan by the AI, or guessed from the tracking texts (never the item names:
 * "Air Max" is a shoe).
 */
export function shippingModeOf(parcel: Shippable): { mode: ShippingMode | null; source: "manual" | "scan" | "guess" | null } {
  if (parcel.shippingMode) return { mode: parcel.shippingMode, source: "manual" };
  if (parcel.info.shippingMode) return { mode: parcel.info.shippingMode, source: "scan" };
  const { info } = parcel;
  const guess = detectShippingMode([
    info.trackingNumber,
    info.orderNumber,
    info.carrier,
    info.statusLabel,
    info.lastEvent?.description,
    info.lastEvent?.location,
    ...(parcel.timeline ?? []).flatMap((item) => [item.statusLabel, item.event?.description, item.event?.location]),
  ]);
  return { mode: guess, source: guess ? "guess" : null };
}

/** Public multi-carrier tracking page for a tracking number. */
export function trackingUrl(trackingNumber: string, locale: string) {
  return `https://t.17track.net/${locale === "fr" ? "fr" : "en"}#nums=${encodeURIComponent(trackingNumber.replace(/\s/g, ""))}`;
}

/** Lower case, no accents, single spaces: "Livré à Foshan" → "livre a foshan". */
export function normaliseSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s\u00a0\u202f]+/g, " ")
    .trim();
}

/**
 * Whether every word of the query appears somewhere in the given texts.
 * Numbers also match without their spaces or dashes ("7734 4529" finds
 * "773445294766417").
 */
export function matchesSearch(texts: Array<string | number | null | undefined>, query: string) {
  const terms = normaliseSearch(query).split(" ").filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = normaliseSearch(texts.filter((text) => text !== null && text !== undefined && text !== "").join(" | "));
  const compact = haystack.replace(/[\s-]/g, "");
  return terms.every((term) => haystack.includes(term) || compact.includes(term.replace(/-/g, "")));
}
