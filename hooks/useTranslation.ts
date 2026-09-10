import { useRouter } from "next/router";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { defaultLocale, type Locale } from "@/i18n.config";

function resolvePath(dictionary: unknown, path: string): string {
  const value = path.split(".").reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === "object" && segment in acc) {
      return (acc as Record<string, unknown>)[segment];
    }
    return undefined;
  }, dictionary);

  return typeof value === "string" ? value : path;
}

export function useTranslation() {
  const router = useRouter();
  const locale = (router.locale as Locale | undefined) ?? defaultLocale;
  const dictionary = dictionaries[locale] ?? dictionaries[defaultLocale];

  return {
    locale,
    t: (key: string) => resolvePath(dictionary, key),
  };
}
