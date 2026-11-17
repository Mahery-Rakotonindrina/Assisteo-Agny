import { useEffect, useMemo } from "react";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDate } from "@/lib/format";
import { liveProfiles, ownerName } from "@/lib/healthProfiles";
import { removeOrphanVaccines, type VaccineReminder } from "@/lib/vaccines";
import { useSettings } from "@/lib/settings/SettingsProvider";
import { reconcileVaccineReminders } from "@/services/vaccineReminders";

/**
 * Keeps the reminders of the next vaccine doses (Ma santé) in line with the
 * vaccines and the plan (the reminders, from Lite): the day before at 9 h.
 * Without the plan they are cancelled, and come back with it.
 */
export function VaccineReminderKeeper() {
  const { t, locale } = useTranslation();
  const { settings, ready, update } = useSettings();
  const { plan, has } = usePlan();
  // Unknown until the plan is read once (cache or server): nothing is cancelled meanwhile.
  const known = plan !== null;
  const enabled = has("reminders");
  const vaccines = settings.vaccines;
  const profiles = settings.healthProfiles;
  // The relatives' names are in the texts: a rename schedules them again (with the language).
  const variant = `${locale}|${liveProfiles(profiles)
    .map((profile) => `${profile.id}=${profile.name}`)
    .join(",")}`;

  const texts = useMemo(
    () => (reminder: VaccineReminder) => {
      const { vaccine } = reminder;
      // A relative's vaccine starts with their first name ("Rado : …").
      const name = ownerName(vaccine.profileId, profiles);
      const body = t("health.vaccines.reminders.body", { date: formatDate(vaccine.nextAt ?? reminder.at, locale) });
      return { title: t("health.vaccines.reminders.title", { name: vaccine.name }), body: name ? t("health.profiles.named", { name, text: body }) : body };
    },
    [t, locale, profiles],
  );

  useEffect(() => {
    if (!ready || !known) return;
    const timer = setTimeout(() => void reconcileVaccineReminders(vaccines, profiles, texts, enabled, variant), 1900);
    return () => clearTimeout(timer);
  }, [ready, known, enabled, vaccines, profiles, texts, variant]);

  // A removed relative's vaccines still here (removed from an older app, or
  // written offline meanwhile): removed in turn, like a removal by hand, so
  // the account and the other devices follow. Only for a relative whose
  // removal is known (its tombstone), never one not received yet.
  useEffect(() => {
    if (!ready) return;
    const cleaned = removeOrphanVaccines(vaccines, profiles, Date.now());
    if (cleaned) update({ vaccines: cleaned });
  }, [ready, vaccines, profiles, update]);

  return null;
}
