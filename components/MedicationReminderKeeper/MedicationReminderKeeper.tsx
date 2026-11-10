import { useCallback, useEffect, useRef } from "react";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { ownerName } from "@/lib/healthProfiles";
import { useSettings } from "@/lib/settings/SettingsProvider";
import { historyStore } from "@/services/historyStore";
import { reconcileMedicationReminders, registerMedicationActions, type MedicationReminderTexts } from "@/services/medicationReminders";

/**
 * Keeps the dose notifications (prescriptions, medicine boxes) in line with
 * the plans confirmed on the scans and the account's plan, at launch and
 * whenever either changes. Without the reminders they are cancelled, and come
 * back with them.
 */
export function MedicationReminderKeeper() {
  const { t } = useTranslation();
  const { ready, settings } = useSettings();
  const profiles = settings.healthProfiles;
  const { plan, has } = usePlan();
  // Unknown until the plan is read once (cache or server): nothing is cancelled meanwhile.
  const known = plan !== null;
  const enabled = has("reminders");
  const texts = useCallback<MedicationReminderTexts>(
    ({ medicines, kind, renew }) =>
      kind === "lastDay"
        ? {
            title: t("health.lastDay.title", { names: medicines.map(({ name }) => name).join(", ") }),
            body: renew ? t("health.lastDay.renew") : t("health.lastDay.body"),
          }
        : {
            title: t("medicine.reminder.title"),
            body: medicines.map(({ name, dose }) => (dose ? t("medicine.reminder.withDose", { name, dose }) : name)).join(" · "),
          },
    [t],
  );
  const latest = useRef<MedicationReminderTexts>(texts);

  useEffect(() => {
    latest.current = texts;
    // The "J'ai pris" button of the dose notifications, in the user's language.
    void registerMedicationActions(t("health.taken")).catch(() => undefined);
  }, [texts, t]);

  useEffect(() => {
    if (!ready || !known) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        // A relative's doses start with their first name ("Rado : 1 comprimé…"): a changed text is scheduled again.
        const owners = new Map((await historyStore.list().catch(() => [])).map((entry) => [entry.id, entry.profileId]));
        void reconcileMedicationReminders((reminder) => {
          const text = latest.current(reminder);
          const name = ownerName(owners.get(reminder.entryId), profiles);
          return name ? { ...text, body: t("health.profiles.named", { name, text: text.body }) } : text;
        }, enabled);
      }, 1200);
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
  }, [ready, known, enabled, texts, profiles, t]);

  return null;
}
