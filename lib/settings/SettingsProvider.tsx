import { Preferences } from "@capacitor/preferences";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { defaultLocale, locales, type Locale } from "@/i18n.config";
import { setHapticsEnabled } from "@/services/device";

export type ThemePreference = "system" | "light" | "dark";

export type Settings = {
  locale: Locale;
  theme: ThemePreference;
  /** Notify when an analysis finishes while the app is in the background. */
  notifyOnResult: boolean;
  haptics: boolean;
};

type SettingsContextValue = {
  settings: Settings;
  /** False until persisted settings have been read on the client. */
  ready: boolean;
  update: (patch: Partial<Settings>) => void;
};

const STORAGE_KEY = "settings.v1";

const defaults: Settings = {
  locale: defaultLocale,
  theme: "system",
  notifyOnResult: true,
  haptics: true,
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

function detectLocale(): Locale {
  const preferred = typeof navigator !== "undefined" ? navigator.language.slice(0, 2) : "";
  return (locales as readonly string[]).includes(preferred) ? (preferred as Locale) : defaultLocale;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(defaults);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Preferences.get({ key: STORAGE_KEY })
      .then(({ value }) => {
        if (cancelled) return;
        const stored = value ? (JSON.parse(value) as Partial<Settings>) : {};
        setSettings({ ...defaults, locale: detectLocale(), ...stored });
      })
      .catch(() => {
        if (!cancelled) setSettings({ ...defaults, locale: detectLocale() });
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Reflect settings on the document and on device services.
  useEffect(() => {
    const root = document.documentElement;
    root.lang = settings.locale;
    if (settings.theme === "system") delete root.dataset.theme;
    else root.dataset.theme = settings.theme;
    setHapticsEnabled(settings.haptics);
  }, [settings]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      void Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(next) });
      return next;
    });
  }, []);

  const value = useMemo(() => ({ settings, ready, update }), [settings, ready, update]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) throw new Error("useSettings must be used inside <SettingsProvider>.");
  return context;
}
