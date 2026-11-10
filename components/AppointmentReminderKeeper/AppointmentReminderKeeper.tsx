import { useEffect, useMemo } from "react";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import type { AppointmentReminder } from "@/lib/appointments";
import { formatDateTime, formatTime } from "@/lib/format";
import { useSettings } from "@/lib/settings/SettingsProvider";
import { reconcileAppointmentReminders } from "@/services/appointmentReminders";

/**
 * Keeps the reminders of the medical appointments (Ma santé) in line with
 * the appointments and the plan (the reminders, from Lite): the day before
 * at 18 h and 2 h before. Without the plan they are cancelled, and come back
 * with it.
 */
export function AppointmentReminderKeeper() {
  const { t, locale } = useTranslation();
  const { settings, ready } = useSettings();
  const { plan, has } = usePlan();
  // Unknown until the plan is read once (cache or server): nothing is cancelled meanwhile.
  const known = plan !== null;
  const enabled = has("reminders");
  const appointments = settings.appointments;

  const texts = useMemo(
    () => (reminder: AppointmentReminder) => {
      const { appointment } = reminder;
      const who = appointment.who || t("health.appointments.reminders.someone");
      const where = appointment.place ? t("health.appointments.reminders.where", { place: appointment.place }) : "";
      if (reminder.kind === "eve") return { title: t("health.appointments.reminders.titleEve", { who }), body: `${t("health.appointments.reminders.eve", { when: formatDateTime(appointment.at, locale) })}${where}` };
      return { title: t("health.appointments.reminders.titleSoon", { who }), body: `${t("health.appointments.reminders.soon", { time: formatTime(appointment.at, locale) })}${where}` };
    },
    [t, locale],
  );

  useEffect(() => {
    if (!ready || !known) return;
    const timer = setTimeout(() => void reconcileAppointmentReminders(appointments, texts, enabled, locale), 1700);
    return () => clearTimeout(timer);
  }, [ready, known, enabled, appointments, texts, locale]);

  return null;
}
