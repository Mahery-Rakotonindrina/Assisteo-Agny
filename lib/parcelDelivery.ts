import type { Locale } from "@/i18n.config";
import { eventTime, type ParcelInfo } from "@/lib/parcels";

// The expected delivery day of a parcel, told in Madagascar time (UTC+3, no
// daylight saving) whatever the device's time zone.

const MADAGASCAR_OFFSET_HOURS = 3;
const HOUR = 3_600_000;

/** A calendar day; `month` from 1 to 12. */
export type CalendarDay = { year: number; month: number; day: number };

const dayNumber = ({ year, month, day }: CalendarDay) => year * 10_000 + month * 100 + day;

/**
 * The day the parcel is expected, as written: "YYYY-MM-DD", "DD/MM/YYYY"…
 * For a range ("2026-10-20 – 2026-10-25"), its first day. Null when unreadable.
 */
export function expectedDay(estimatedDelivery: string | null | undefined): CalendarDay | null {
  const time = eventTime(estimatedDelivery);
  if (time === null) return null;
  // eventTime builds a local date from the written numbers: read them back the same way.
  const date = new Date(time);
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

/** Today in Madagascar. */
export function madagascarDay(now: number): CalendarDay {
  const date = new Date(now + MADAGASCAR_OFFSET_HOURS * HOUR);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** That day at `hour`:00 in Madagascar, as a timestamp. */
export function madagascarTime(day: CalendarDay, hour: number) {
  return Date.UTC(day.year, day.month - 1, day.day, hour - MADAGASCAR_OFFSET_HOURS);
}

type Deliverable = { info: Pick<ParcelInfo, "estimatedDelivery" | "status">; receivedAt?: number };

/**
 * A parcel still awaited: not in the user's hands yet. "Delivered" by the
 * carrier often means the forwarder's warehouse abroad, and the expected day
 * is then the forwarder's own (arrival in Madagascar): it still counts.
 */
const awaited = (parcel: Deliverable) => !parcel.receivedAt;

export type DeliveryState = { when: "upcoming" | "today" | "late"; day: CalendarDay };

/** Where an awaited parcel stands against its expected day; null without one. */
export function deliveryState(parcel: Deliverable, now: number): DeliveryState | null {
  if (!awaited(parcel)) return null;
  const day = expectedDay(parcel.info.estimatedDelivery);
  if (!day) return null;
  const [expected, today] = [dayNumber(day), dayNumber(madagascarDay(now))];
  return { when: expected > today ? "upcoming" : expected === today ? "today" : "late", day };
}

/**
 * When to notify that the parcel arrives today: the expected day at `hour`
 * (Madagascar time). Null when not awaited, without a day, or already past.
 */
export function deliveryNotifyAt(parcel: Deliverable, hour: number, now: number) {
  if (!awaited(parcel)) return null;
  const day = expectedDay(parcel.info.estimatedDelivery);
  if (!day) return null;
  const at = madagascarTime(day, clampHour(hour));
  return at > now ? at : null;
}

/** An hour of the day, 0 to 23. */
export function clampHour(hour: number) {
  return Number.isFinite(hour) ? Math.min(23, Math.max(0, Math.round(hour))) : 8;
}

const localeTags: Record<Locale, string> = { fr: "fr-FR", en: "en-GB" };

/** "lun. 20 oct." (or "20 oct." without the weekday), whatever the device's time zone. */
export function formatDay(day: CalendarDay, locale: Locale, { weekday = true } = {}) {
  return new Intl.DateTimeFormat(localeTags[locale], {
    ...(weekday && { weekday: "short" as const }),
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(Date.UTC(day.year, day.month - 1, day.day, 12));
}
