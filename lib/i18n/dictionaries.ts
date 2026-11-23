import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import type { Locale } from "@/i18n.config";

export type Dictionary = typeof fr;

// French and English are in the app's first load. Malagasy (a plan feature,
// ~245 KB) is a separate chunk, fetched only when the language is `mg`: the
// French shows until it is there, and stays if it cannot be loaded.
const loaded: Partial<Record<Locale, Dictionary>> = { en, fr };
const loaders: Partial<Record<Locale, () => Promise<Dictionary>>> = { mg: () => import("@/locales/mg.json").then((module) => module.default) };
const loading = new Set<Locale>();
const listeners = new Set<() => void>();

/** The dictionary of a language when it is loaded (French and English always are). */
export const loadedDictionary = (locale: Locale): Dictionary | undefined => loaded[locale];

export function subscribeDictionaries(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Starts loading a language's dictionary; the subscribers are told once it is there. A failure is retried on the next call. */
export function loadDictionary(locale: Locale) {
  const load = loaders[locale];
  if (!load || loaded[locale] || loading.has(locale)) return;
  loading.add(locale);
  load()
    .then((dictionary) => {
      loaded[locale] = dictionary;
      listeners.forEach((listener) => listener());
    })
    .catch(() => {
      // Offline or chunk missing: the French stays.
    })
    .finally(() => loading.delete(locale));
}
