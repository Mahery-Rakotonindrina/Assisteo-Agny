import type { Locale } from "@/i18n.config";

const localeTags: Record<Locale, string> = { fr: "fr-FR", en: "en-GB" };

export function formatTime(timestamp: number, locale: Locale) {
  return new Intl.DateTimeFormat(localeTags[locale], { hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

export function formatDateTime(timestamp: number, locale: Locale) {
  return new Intl.DateTimeFormat(localeTags[locale], {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

export function formatDay(timestamp: number, locale: Locale) {
  return new Intl.DateTimeFormat(localeTags[locale], { weekday: "long", day: "numeric", month: "long" }).format(timestamp);
}

/** A short date: "12 oct. 2026" / "12 Oct 2026". */
export function formatDate(timestamp: number, locale: Locale) {
  return new Intl.DateTimeFormat(localeTags[locale], { day: "numeric", month: "short", year: "numeric" }).format(timestamp);
}

/** Local day of a timestamp, as a date input value: "2026-10-12". */
export function toDateInput(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function startOfDay(timestamp: number) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** An amount in Malagasy ariary, e.g. "245 000 Ar" (no decimals). */
export function formatAriary(value: number, locale: Locale) {
  return `${new Intl.NumberFormat(localeTags[locale], { maximumFractionDigits: 0 }).format(Math.round(value))} Ar`;
}

export function formatNumber(value: number, locale: Locale) {
  return new Intl.NumberFormat(localeTags[locale], { maximumFractionDigits: 0 }).format(value);
}

/**
 * Short reminder time for lists: "14:30" today, "demain 09:00" / "tomorrow
 * 09:00", else "lun. 14 oct., 09:00".
 */
export function formatReminder(timestamp: number, now: number, locale: Locale) {
  const time = formatTime(timestamp, locale);
  const days = Math.round((startOfDay(timestamp) - startOfDay(now)) / 86_400_000);
  if (days === 0) return time;
  if (days === 1) return `${locale === "fr" ? "demain" : "tomorrow"} ${time}`;
  return formatDateTime(timestamp, locale);
}

/** A month, short: "oct." / "Oct". */
export function formatMonth(timestamp: number, locale: Locale) {
  return new Intl.DateTimeFormat(localeTags[locale], { month: "short" }).format(timestamp);
}

/** A big number in a few characters: "45 k", "1,2 M". */
export function formatCompact(value: number, locale: Locale) {
  return new Intl.NumberFormat(localeTags[locale], { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

/** A month and its year: "octobre 2026" / "October 2026". */
export function formatMonthYear(timestamp: number, locale: Locale) {
  return new Intl.DateTimeFormat(localeTags[locale], { month: "long", year: "numeric" }).format(timestamp);
}

/** A number with up to two decimals: "221,45" / "221.45". */
export function formatDecimal(value: number, locale: Locale) {
  return new Intl.NumberFormat(localeTags[locale], { maximumFractionDigits: 2 }).format(value);
}
