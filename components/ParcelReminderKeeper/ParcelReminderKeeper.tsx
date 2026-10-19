import { useEffect, useRef } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { useSettings } from "@/lib/settings/SettingsProvider";
import { parcelStore, type Parcel } from "@/services/parcelStore";
import { reconcileParcelReminders } from "@/services/parcelReminders";

/**
 * Keeps the "your parcel arrives today" notifications in line with the
 * parcels and the settings, at launch and whenever either changes.
 */
export function ParcelReminderKeeper() {
  const { t } = useTranslation();
  const { settings, ready } = useSettings();
  const { parcelNotify: enabled, parcelNotifyHour: hour } = settings;
  const latest = useRef({ options: { enabled, hour }, texts: (parcel: Parcel) => ({ title: "", body: parcel.title }) });

  useEffect(() => {
    latest.current = {
      options: { enabled, hour },
      texts: (parcel) => ({ title: t("notifications.parcelTitle"), body: t("notifications.parcelBody", { title: parcel.title }) }),
    };
  }, [enabled, hour, t]);

  useEffect(() => {
    if (!ready) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void reconcileParcelReminders(latest.current.options, latest.current.texts), 1200);
    };
    run();
    const unsubscribe = parcelStore.subscribe(run);
    const onVisible = () => document.visibilityState === "visible" && run();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
    // Settings changes re-run it; the texts follow through the ref.
  }, [ready, enabled, hour]);

  return null;
}
