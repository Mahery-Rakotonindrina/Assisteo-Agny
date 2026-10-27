import { useEffect, useRef } from "react";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { useSettings } from "@/lib/settings/SettingsProvider";
import { parcelStore, type Parcel } from "@/services/parcelStore";
import { reconcileParcelReminders } from "@/services/parcelReminders";

/**
 * Keeps the "your parcel arrives today" notifications in line with the
 * parcels, the settings and the plan (Lite and up), at launch and whenever
 * one changes.
 */
export function ParcelReminderKeeper() {
  const { t } = useTranslation();
  const { settings, ready } = useSettings();
  const { parcelNotify: enabled, parcelNotifyHour: hour } = settings;
  const { plan, has } = usePlan();
  // Unknown until the plan is read once (cache or server): nothing is cancelled meanwhile.
  const known = plan !== null;
  const paid = has("reminders");
  const latest = useRef({ options: { enabled, hour, paid }, texts: (parcel: Parcel) => ({ title: "", body: parcel.title }) });

  useEffect(() => {
    latest.current = {
      options: { enabled, hour, paid },
      texts: (parcel) => ({ title: t("notifications.parcelTitle"), body: t("notifications.parcelBody", { title: parcel.title }) }),
    };
  }, [enabled, hour, paid, t]);

  useEffect(() => {
    if (!ready || !known) return;
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
  }, [ready, known, enabled, hour, paid]);

  return null;
}
