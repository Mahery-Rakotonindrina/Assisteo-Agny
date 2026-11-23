import type { Locale } from "@/i18n.config";

const wantedTags: Record<Locale, string> = { fr: "fr-FR", en: "en-GB", mg: "mg-MG" };

// The Android WebView does not always ship Malagasy data: then dates and
// numbers follow French (the language of the app's default), never an error.
const tagCache = new Map<Locale, string>();

/** The BCP 47 tag to format dates and numbers with: Malagasy when the engine knows it, else French. */
export function formatTag(locale: Locale) {
  let tag = tagCache.get(locale);
  if (!tag) {
    tag = wantedTags[locale];
    try {
      if (Intl.DateTimeFormat.supportedLocalesOf([tag]).length === 0 || Intl.NumberFormat.supportedLocalesOf([tag]).length === 0) tag = wantedTags.fr;
    } catch {
      tag = wantedTags.fr;
    }
    tagCache.set(locale, tag);
  }
  return tag;
}

/**
 * The tag for numbers and amounts. Malagasy dates have their own tag, but the
 * engine writes its numbers the English way ("245,000", "221.45"): there the
 * comma is read as a decimal. Madagascar writes them as the French do.
 */
export function numberTag(locale: Locale) {
  return locale === "mg" ? formatTag("fr") : formatTag(locale);
}

export function formatTime(timestamp: number, locale: Locale) {
  return new Intl.DateTimeFormat(formatTag(locale), { hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

export function formatDateTime(timestamp: number, locale: Locale) {
  return new Intl.DateTimeFormat(formatTag(locale), {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

export function formatDay(timestamp: number, locale: Locale) {
  return new Intl.DateTimeFormat(formatTag(locale), { weekday: "long", day: "numeric", month: "long" }).format(timestamp);
}

/** A short date: "12 oct. 2026" / "12 Oct 2026". */
export function formatDate(timestamp: number, locale: Locale) {
  return new Intl.DateTimeFormat(formatTag(locale), { day: "numeric", month: "short", year: "numeric" }).format(timestamp);
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

/** A size on the device: "24,3 Mo" or "512 Ko" in French, "24.3 MB" or "512 KB" in English. */
export function formatBytes(bytes: number, locale: Locale) {
  const [kb, mb] = locale === "en" ? ["KB", "MB"] : ["Ko", "Mo"];
  const megabytes = bytes / (1024 * 1024);
  return megabytes >= 1
    ? `${megabytes.toLocaleString(numberTag(locale), { maximumFractionDigits: 1 })} ${mb}`
    : `${Math.max(0, Math.round(bytes / 1024)).toLocaleString(numberTag(locale))} ${kb}`;
}

/** An amount in Malagasy ariary, e.g. "245 000 Ar" (no decimals). */
export function formatAriary(value: number, locale: Locale) {
  return `${new Intl.NumberFormat(numberTag(locale), { maximumFractionDigits: 0 }).format(Math.round(value))} Ar`;
}

export function formatNumber(value: number, locale: Locale) {
  return new Intl.NumberFormat(numberTag(locale), { maximumFractionDigits: 0 }).format(value);
}

/**
 * Short reminder time for lists: "14:30" today, "demain 09:00" / "tomorrow
 * 09:00", else "lun. 14 oct., 09:00".
 */
export function formatReminder(timestamp: number, now: number, locale: Locale) {
  const time = formatTime(timestamp, locale);
  const days = Math.round((startOfDay(timestamp) - startOfDay(now)) / 86_400_000);
  if (days === 0) return time;
  if (days === 1) return `${locale === "fr" ? "demain" : locale === "mg" ? "rahampitso" : "tomorrow"} ${time}`;
  return formatDateTime(timestamp, locale);
}

/** A month, short: "oct." / "Oct". */
export function formatMonth(timestamp: number, locale: Locale) {
  return new Intl.DateTimeFormat(formatTag(locale), { month: "short" }).format(timestamp);
}

/** A big number in a few characters: "45 k", "1,2 M". */
export function formatCompact(value: number, locale: Locale) {
  return new Intl.NumberFormat(numberTag(locale), { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

/** A month and its year: "octobre 2026" / "October 2026". */
export function formatMonthYear(timestamp: number, locale: Locale) {
  return new Intl.DateTimeFormat(formatTag(locale), { month: "long", year: "numeric" }).format(timestamp);
}

/** A measure: at most so many decimals ("64,5", "1,05", "128"). */
export function formatMeasure(value: number, decimals: number, locale: Locale) {
  return new Intl.NumberFormat(numberTag(locale), { maximumFractionDigits: decimals }).format(value);
}

/** A number with up to two decimals: "221,45" / "221.45". */
export function formatDecimal(value: number, locale: Locale) {
  return new Intl.NumberFormat(numberTag(locale), { maximumFractionDigits: 2 }).format(value);
}
