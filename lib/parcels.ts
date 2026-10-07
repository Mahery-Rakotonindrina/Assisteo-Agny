import type { Analysis, ParcelStatus } from "@/lib/ai/schema";

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

/** Public multi-carrier tracking page for a tracking number. */
export function trackingUrl(trackingNumber: string, locale: string) {
  return `https://t.17track.net/${locale === "fr" ? "fr" : "en"}#nums=${encodeURIComponent(trackingNumber.replace(/\s/g, ""))}`;
}
