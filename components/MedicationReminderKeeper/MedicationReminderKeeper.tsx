import { useCallback, useEffect, useRef } from "react";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { useSettings } from "@/lib/settings/SettingsProvider";
import { historyStore } from "@/services/historyStore";
import { reconcileMedicationReminders, type MedicationReminderTexts } from "@/services/medicationReminders";

/**
 * Keeps the dose notifications (prescriptions, medicine boxes) in line with
 * the plans confirmed on the scans and the account's plan, at launch and
 * whenever either changes. Without the reminders they are cancelled, and come
 * back with them.
 */
export function MedicationReminderKeeper() {
  const { t } = useTranslation();
  const { ready } = useSettings();
  const { plan, has } = usePlan();
  // Unknown until the plan is read once (cache or server): nothing is cancelled meanwhile.
  const known = plan !== null;
  const enabled = has("reminders");
  const texts = useCallback<MedicationReminderTexts>(
    ({ medicines }) => ({
      title: t("medicine.reminder.title"),
      body: medicines.map(({ name, dose }) => (dose ? t("medicine.reminder.withDose", { name, dose }) : name)).join(" · "),
    }),
    [t],
  );
  const latest = useRef<MedicationReminderTexts>(texts);

  useEffect(() => {
    latest.current = texts;
  }, [texts]);

  useEffect(() => {
    if (!ready || !known) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void reconcileMedicationReminders((reminder) => latest.current(reminder), enabled), 1200);
    };
    run();
    const unsubscribe = historyStore.subscribe(run);
    const onVisible = () => document.visibilityState === "visible" && run();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
    // A language change re-runs it, so the texts follow.
  }, [ready, known, enabled, texts]);

  return null;
}
