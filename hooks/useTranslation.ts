import { useCallback } from "react";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { defaultLocale } from "@/i18n.config";
import { useSettings } from "@/lib/settings/SettingsProvider";

function lookup(dictionary: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === "object" && segment in acc) {
      return (acc as Record<string, unknown>)[segment];
    }
    return undefined;
  }, dictionary);
}

function resolvePath(dictionary: unknown, path: string): string {
  const value = lookup(dictionary, path);
  return typeof value === "string" ? value : path;
}

type Params = Record<string, string | number>;

// The locale lives in user settings rather than in the URL: Next's i18n
// routing is not available in the static export used by the mobile app.
export function useTranslation() {
  const { settings } = useSettings();
  const locale = settings.locale;
  const dictionary = dictionaries[locale] ?? dictionaries[defaultLocale];

  const t = useCallback(
    (key: string, params?: Params) => {
      const text = resolvePath(dictionary, key);
      if (!params) return text;
      return text.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in params ? String(params[name]) : match,
      );
    },
    [dictionary],
  );

  const list = useCallback(
    (key: string): string[] => {
      const value = lookup(dictionary, key);
      return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    },
    [dictionary],
  );

  return { locale, t, list };
}
