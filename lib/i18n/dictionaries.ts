import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import type { Locale } from "@/i18n.config";

export const dictionaries: Record<Locale, typeof fr> = { en, fr };

export type Dictionary = (typeof dictionaries)[Locale];
