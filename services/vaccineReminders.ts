import type { HealthProfile } from "@/lib/healthProfiles";
import { vaccineReminders, type Vaccine, type VaccineReminder } from "@/lib/vaccines";
import { deviceReminderDeps, reconcileScheduledReminders, type AppointmentReminderDeps } from "./appointmentReminders";

// The reminders of the next vaccine doses (Ma santé, lib/vaccines.ts): the day
// before at 9 h, local notifications, like the appointments' (same plan, same
// service). Rescheduled when the app opens and at each change
// (VaccineReminderKeeper). Nothing on the server.

export { VACCINE_NOTIFICATION_PREFIX } from "@/lib/vaccines";

const STORAGE_KEY = "vaccine-reminders-scheduled.v1";

type Texts = { title: string; body: string };

/** Brings the scheduled reminders in line with the vaccines and the plan (all cancelled without it). */
export function reconcileVaccineReminderState(
  vaccines: Vaccine[] | null,
  texts: (reminder: VaccineReminder) => Texts,
  deps: AppointmentReminderDeps,
  { enabled = true, now = Date.now(), language = "", profiles }: { enabled?: boolean; now?: number; language?: string; profiles?: HealthProfile[] | null } = {},
) {
  return reconcileScheduledReminders(vaccineReminders(vaccines, now, enabled, profiles), texts, deps, language);
}

/** Reconciles this device's vaccine reminders. */
export function reconcileVaccineReminders(vaccines: Vaccine[] | null, profiles: HealthProfile[] | null, texts: (reminder: VaccineReminder) => Texts, enabled: boolean, language: string) {
  return reconcileVaccineReminderState(vaccines, texts, deviceReminderDeps(STORAGE_KEY), { enabled, language, profiles }).catch(() => undefined);
}
