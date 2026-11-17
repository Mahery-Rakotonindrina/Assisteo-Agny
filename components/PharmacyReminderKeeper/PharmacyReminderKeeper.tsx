import { useEffect, useMemo } from "react";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDate, formatMonthYear } from "@/lib/format";
import { liveProfiles } from "@/lib/healthProfiles";
import { expiryDay, hasExpiryDay, type PharmacyReminder } from "@/lib/pharmacy";
import { useSettings } from "@/lib/settings/SettingsProvider";
import { reconcilePharmacyReminders } from "@/services/pharmacyReminders";

/**
 * Keeps the alerts of the home medicines (Ma santé) in line with the
 * medicines and the plan (the reminders, from Lite): a month before the
 * expiry and on the day, at 9 h. Without the plan they are cancelled, and
 * come back with it.
 */
export function PharmacyReminderKeeper() {
  const { t, locale } = useTranslation();
  const { settings, ready } = useSettings();
  const { plan, has } = usePlan();
  // Unknown until the plan is read once (cache or server): nothing is cancelled meanwhile.
  const known = plan !== null;
  const enabled = has("reminders");
  const medicines = settings.pharmacy;
  const profiles = settings.healthProfiles;
  // The relatives' names are in the texts: a rename schedules them again (with the language).
  const variant = `${locale}|${liveProfiles(profiles)
    .map((profile) => `${profile.id}=${profile.name}`)
    .join(",")}`;

  const texts = useMemo(
    () => (reminder: PharmacyReminder) => {
      const { medicine } = reminder;
      const when = hasExpiryDay(medicine.expiry) ? formatDate(expiryDay(medicine.expiry), locale) : formatMonthYear(expiryDay(medicine.expiry), locale);
      const name = medicine.forWho && medicine.forWho !== "me" ? (liveProfiles(profiles).find((item) => item.id === medicine.forWho)?.name ?? null) : null;
      const body = t(reminder.kind === "month" ? "health.pharmacy.reminders.monthBody" : "health.pharmacy.reminders.dayBody", { date: when });
      return {
        title: t(reminder.kind === "month" ? "health.pharmacy.reminders.monthTitle" : "health.pharmacy.reminders.dayTitle", { name: medicine.name }),
        body: name ? t("health.profiles.named", { name, text: body }) : body,
      };
    },
    [t, locale, profiles],
  );

  useEffect(() => {
    if (!ready || !known) return;
    const timer = setTimeout(() => void reconcilePharmacyReminders(medicines, texts, enabled, variant), 2100);
    return () => clearTimeout(timer);
  }, [ready, known, enabled, medicines, texts, variant]);

  return null;
}
