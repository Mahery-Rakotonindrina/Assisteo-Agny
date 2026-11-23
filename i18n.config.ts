export const locales = ["fr", "en", "mg"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "fr";
