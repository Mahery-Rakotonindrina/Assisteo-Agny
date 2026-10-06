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

export function startOfDay(timestamp: number) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function formatNumber(value: number, locale: Locale) {
  return new Intl.NumberFormat(localeTags[locale], { maximumFractionDigits: 0 }).format(value);
}
