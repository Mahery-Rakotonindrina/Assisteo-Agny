import type { ParcelStatus } from "@/lib/ai/schema";
import { eventTime, parcelScanHasNews, type ParcelInfo } from "@/lib/parcels";

// Automatic tracking of "Mes colis" (Premium): the server asks 17TRACK about
// the synced parcels every few hours (pages/api/cron/parcel-tracking.ts) and
// writes a change of status into the parcel's row. Pure, shared by the cron
// and the screen.

/** The timeline's `scanId` of a status found by the automatic tracking (no scan, no hand edit). */
export const AUTO_TRACK_SCAN_ID = "auto-track";

/** What the server keeps on a parcel it tracks (in the synced JSON, beside the user's fields). */
export type ParcelAutoTrack = {
  /** Last time 17TRACK was asked about it. */
  checkedAt: number;
  /** The tracking number asked about (normalised). */
  number: string;
  /** 17TRACK refused the number (bad format, carrier unknown): the parcel isn't followed, the screen says nothing. Gone with a real answer. */
  refused?: true;
};

/** The fields of a synced parcel row the tracking reads or writes; the others pass through untouched. */
export type TrackedParcel = {
  id: string;
  title: string;
  info: ParcelInfo;
  timeline: Array<{ at: number; status: ParcelStatus; statusLabel: string; event: ParcelInfo["lastEvent"]; scanId: string }>;
  createdAt: number;
  updatedAt?: number;
  receivedAt?: number;
  deletedAt?: number;
  autoTrack?: ParcelAutoTrack;
};

/** A parcel without any movement for this long is left alone (lost, or forgotten in the list). */
export const STALE_AFTER_MS = 90 * 86_400_000;
/** Not asked again sooner (the cron runs every 3 hours; a little slack for its late starts). */
export const RECHECK_AFTER_MS = 150 * 60_000;

/** A tracking number as 17TRACK takes it: letters, digits and dashes, 5 to 50 of them; null otherwise. */
export function trackingKey(value: string | null | undefined) {
  const key = (value ?? "").replace(/[\s.]/g, "").toUpperCase();
  return /^[A-Z0-9-]{5,50}$/.test(key) ? key : null;
}

/** When the parcel last moved: its last status recorded, its carrier's last event, or when it was added. */
export function lastMovement(parcel: TrackedParcel) {
  const recorded = parcel.timeline.reduce((latest, item) => Math.max(latest, item.at || 0), 0);
  return Math.max(recorded, eventTime(parcel.info.lastEvent?.at) ?? 0, parcel.createdAt || 0);
}

/**
 * Whether the cron should ask about this parcel now: a valid tracking
 * number, still on its way (not delivered, returned or in hand), some
 * movement in the last 90 days, and not asked in the last 2 h 30.
 */
export function needsCheck(parcel: TrackedParcel, now: number) {
  if (parcel.deletedAt || parcel.receivedAt) return false;
  if (!trackingKey(parcel.info?.trackingNumber)) return false;
  if (parcel.info.status === "delivered" || parcel.info.status === "returned") return false;
  if (now - lastMovement(parcel) > STALE_AFTER_MS) return false;
  return !parcel.autoTrack || now - parcel.autoTrack.checkedAt >= RECHECK_AFTER_MS;
}

/**
 * The parcels to ask about in this run, least recently checked first (never
 * checked ones before all), within `maxNumbers` distinct tracking numbers:
 * parcels under one number (several orders shipped together) share a request.
 */
export function parcelsToCheck<T extends { parcel: TrackedParcel }>(rows: T[], now: number, maxNumbers: number): T[] {
  const due = rows.filter((row) => needsCheck(row.parcel, now)).sort((a, b) => (a.parcel.autoTrack?.checkedAt ?? 0) - (b.parcel.autoTrack?.checkedAt ?? 0));
  const numbers = new Set<string>();
  const picked: T[] = [];
  for (const row of due) {
    const key = trackingKey(row.parcel.info.trackingNumber)!;
    if (!numbers.has(key)) {
      if (numbers.size >= maxNumbers) continue;
      numbers.add(key);
    }
    picked.push(row);
  }
  return picked;
}

// ---- 17TRACK answers ------------------------------------------------------------

/** One event as 17TRACK gives it (track_info.latest_event, tracking.providers[].events[]). */
export type Track17Event = {
  time_iso?: string | null;
  time_utc?: string | null;
  time_raw?: { date?: string | null; time?: string | null } | null;
  description?: string | null;
  location?: string | null;
};

/** An accepted item of gettrackinfo (only what is read here). */
export type Track17Item = {
  number: string;
  track_info?: {
    latest_status?: { status?: string | null; sub_status?: string | null } | null;
    latest_event?: Track17Event | null;
  } | null;
};

/**
 * A 17TRACK status as a parcel status, or null when it tells nothing to
 * keep: not found yet, or tracking expired (the carrier stopped answering).
 */
export function statusFrom17(status: string | null | undefined, subStatus?: string | null): ParcelStatus | null {
  switch (status) {
    case "InfoReceived":
      return "shipped";
    case "InTransit":
      return subStatus === "InTransit_PickedUp" ? "shipped" : "in_transit";
    case "AvailableForPickup":
      return "pickup_ready";
    case "OutForDelivery":
      return "out_for_delivery";
    case "Delivered":
      return "delivered";
    case "DeliveryFailure":
      return "exception";
    case "Exception":
      if (subStatus === "Exception_Returning" || subStatus === "Exception_Returned") return "returned";
      // Only late: still on its way.
      if (subStatus === "Exception_Delayed") return "in_transit";
      return "exception";
    default:
      return null;
  }
}

/** An event's time as the parcels keep it ("YYYY-MM-DD HH:mm", the carrier's local time), or null. */
export function eventAt(event: Track17Event | null | undefined) {
  const raw = event?.time_raw;
  if (raw?.date && /^\d{4}-\d{2}-\d{2}$/.test(raw.date)) return raw.time ? `${raw.date} ${raw.time.slice(0, 5)}` : raw.date;
  const iso = event?.time_iso ?? event?.time_utc;
  const match = iso?.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return match ? `${match[1]} ${match[2]}` : null;
}

/** What 17TRACK says of a parcel, as the parcel fields it updates; null when it says nothing usable. */
export function trackedInfo(item: Track17Item, labels: Record<ParcelStatus, string>): Pick<ParcelInfo, "status" | "statusLabel" | "lastEvent"> | null {
  const latest = item.track_info?.latest_status;
  const status = statusFrom17(latest?.status, latest?.sub_status);
  if (!status) return null;
  const event = item.track_info?.latest_event;
  const description = event?.description?.trim();
  return {
    status,
    statusLabel: labels[status],
    lastEvent: description ? { description, location: event?.location?.trim() || null, at: eventAt(event) } : null,
  };
}

/**
 * The parcel with what 17TRACK says, and whether it is news: a later point
 * of the journey, or new words from the carrier at the same point (the same
 * rule as a new screenshot, lib/parcels.ts). Only the tracking fields
 * change (status, label, last event, timeline, autoTrack); everything else,
 * the user's own fields first, is kept as it is. Without news, only the time
 * of the check moves. An event 17TRACK doesn't give keeps the parcel's own.
 * `refused`: 17TRACK refused the number; only the check is noted, marked so.
 */
export function mergeTracking<T extends TrackedParcel>(
  parcel: T,
  update: Pick<ParcelInfo, "status" | "statusLabel" | "lastEvent"> | null,
  now: number,
  { refused = false } = {},
): { parcel: T; changed: boolean } {
  const autoTrack: ParcelAutoTrack = { checkedAt: now, number: trackingKey(parcel.info.trackingNumber) ?? "" };
  if (refused) return { parcel: { ...parcel, autoTrack: { ...autoTrack, refused: true } }, changed: false };
  if (!update) return { parcel: { ...parcel, autoTrack }, changed: false };
  const next: ParcelInfo = { ...parcel.info, status: update.status, statusLabel: update.statusLabel, lastEvent: update.lastEvent ?? parcel.info.lastEvent };
  if (!parcelScanHasNews(parcel.info, next)) return { parcel: { ...parcel, autoTrack }, changed: false };
  return {
    parcel: {
      ...parcel,
      info: next,
      timeline: [...parcel.timeline, { at: now, status: next.status, statusLabel: next.statusLabel, event: next.lastEvent, scanId: AUTO_TRACK_SCAN_ID }],
      autoTrack,
    },
    changed: true,
  };
}

/** What a notification was last sent about, to never send it twice (a device may push back an older copy of the row). */
export function trackingSignature(info: Pick<ParcelInfo, "status" | "lastEvent">) {
  return [info.status, info.lastEvent?.at ?? "", info.lastEvent?.description ?? ""].join("|");
}

// ---- On the screen ----------------------------------------------------------------

/** How long ago the last check was, in the largest whole unit: "il y a 2 h". */
export function checkedAgo(checkedAt: number, now: number): { unit: "now" | "minutes" | "hours" | "days"; count: number } {
  const minutes = Math.max(0, Math.floor((now - checkedAt) / 60_000));
  if (minutes < 1) return { unit: "now", count: 0 };
  if (minutes < 60) return { unit: "minutes", count: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: "hours", count: hours };
  return { unit: "days", count: Math.floor(hours / 24) };
}
