import { pharmacyReminders, type HomeMedicine, type PharmacyReminder } from "@/lib/pharmacy";
import { deviceReminderDeps, reconcileScheduledReminders, type AppointmentReminderDeps } from "./appointmentReminders";

// The alerts of the home medicines (Ma santé, lib/pharmacy.ts): a month
// before the expiry and on the day, at 9 h, local notifications, like the
// vaccines' (same plan, same service). Rescheduled when the app opens and at
// each change (PharmacyReminderKeeper). Nothing on the server.

export { PHARMACY_NOTIFICATION_PREFIX } from "@/lib/pharmacy";

const STORAGE_KEY = "pharmacy-reminders-scheduled.v1";

type Texts = { title: string; body: string };

/** Brings the scheduled alerts in line with the medicines and the plan (all cancelled without it). */
export function reconcilePharmacyReminderState(
  medicines: HomeMedicine[] | null,
  texts: (reminder: PharmacyReminder) => Texts,
  deps: AppointmentReminderDeps,
  { enabled = true, now = Date.now(), language = "" }: { enabled?: boolean; now?: number; language?: string } = {},
) {
  return reconcileScheduledReminders(pharmacyReminders(medicines, now, enabled), texts, deps, language);
}

/** Reconciles this device's home medicine alerts. */
export function reconcilePharmacyReminders(medicines: HomeMedicine[] | null, texts: (reminder: PharmacyReminder) => Texts, enabled: boolean, language: string) {
  return reconcilePharmacyReminderState(medicines, texts, deviceReminderDeps(STORAGE_KEY), { enabled, language }).catch(() => undefined);
}
