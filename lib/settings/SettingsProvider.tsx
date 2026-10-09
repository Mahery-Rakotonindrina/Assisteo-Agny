import { Preferences } from "@capacitor/preferences";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { defaultLocale, locales, type Locale } from "@/i18n.config";
import { setDataSaverPreference, type DataSaverPreference } from "@/services/dataSaver";
import { setHapticsEnabled } from "@/services/device";

export type ThemePreference = "system" | "light" | "dark";

export type Settings = {
  locale: Locale;
  theme: ThemePreference;
  /** Notify when an analysis finishes while the app is in the background. */
  notifyOnResult: boolean;
  haptics: boolean;
  /** Lighter photos on slow connections (this device only). */
  dataSaver: DataSaverPreference;
  /** The first-run permission walkthrough has been completed or skipped. */
  onboardingDone: boolean;
  /** Last change to the synced fields, to settle edits from two devices. */
  updatedAt: number;
};

/** Preferences that follow the account across devices (the rest is per device). */
export const syncedSettingKeys = ["locale", "theme", "notifyOnResult", "haptics"] as const;
export type SyncedSettings = Pick<Settings, (typeof syncedSettingKeys)[number]>;

type SettingsContextValue = {
  settings: Settings;
  /** False until persisted settings have been read on the client. */
  ready: boolean;
  /** `fromSync` applies values received from the account without re-sending them. */
  update: (patch: Partial<Settings>, options?: { fromSync?: boolean; updatedAt?: number }) => void;
};

const STORAGE_KEY = "settings.v1";

const defaults: Settings = {
  locale: defaultLocale,
  theme: "system",
  notifyOnResult: true,
  haptics: true,
  dataSaver: "auto",
  onboardingDone: false,
  updatedAt: 0,
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
    setDataSaverPreference(settings.dataSaver);
  }, [settings]);

  const update = useCallback((patch: Partial<Settings>, options: { fromSync?: boolean; updatedAt?: number } = {}) => {
    setSettings((current) => {
      const touchesSynced = syncedSettingKeys.some((key) => key in patch);
      const updatedAt = options.fromSync ? (options.updatedAt ?? current.updatedAt) : touchesSynced ? Date.now() : current.updatedAt;
      const next = { ...current, ...patch, updatedAt };
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
