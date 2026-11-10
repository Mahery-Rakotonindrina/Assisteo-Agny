import { appointmentReminders, type Appointment, type AppointmentReminder } from "@/lib/appointments";
import { cancelNotification, getNotificationPermission, notify, pendingNotificationIds } from "./notifications";

// The reminders of the medical appointments (Ma santé, lib/appointments.ts):
// the day before at 18 h and 2 h before, local notifications. Rescheduled
// when the app opens and at each change (AppointmentReminderKeeper). Nothing
// on the server: the cron doesn't read the appointments.

export { APPOINTMENT_NOTIFICATION_PREFIX } from "@/lib/appointments";

const STORAGE_KEY = "appointment-reminders-scheduled.v1";

/** What this device has scheduled, by reminder key. */
export type ScheduledAppointmentReminders = Record<string, number>;

type Texts = { title: string; body: string };

export type AppointmentReminderDeps = {
  permission: () => Promise<string>;
  notify: (options: Texts & { at: Date; entryId: string }) => Promise<number | null>;
  cancel: (id: number) => Promise<void>;
  pending: () => Promise<Set<number> | null>;
  load: () => ScheduledAppointmentReminders;
  save: (scheduled: ScheduledAppointmentReminders) => void;
};

/**
 * Brings the scheduled reminders in line with the appointments and the plan:
 * cancels the ones no longer wanted (all of them without the plan),
 * schedules the missing ones. Never asks for permission.
 */
export async function reconcileAppointmentReminderState(
  appointments: Appointment[] | null,
  texts: (reminder: AppointmentReminder) => Texts,
  deps: AppointmentReminderDeps,
  { enabled = true, now = Date.now() }: { enabled?: boolean; now?: number } = {},
) {
  const scheduled = deps.load();
  const wanted = new Map(appointmentReminders(appointments, now, enabled).map((reminder) => [reminder.key, reminder]));
  // Without the plan: cancelled even without the permission (nothing to keep).
  if (wanted.size > 0 && (await deps.permission()) !== "granted") return;
  const pending = wanted.size > 0 ? await deps.pending() : null;
  const next: ScheduledAppointmentReminders = {};
  for (const [key, id] of Object.entries(scheduled)) {
    if (wanted.has(key) && (!pending || pending.has(id))) next[key] = id;
    else await deps.cancel(id);
  }
  for (const [key, reminder] of wanted) {
    if (next[key] !== undefined) continue;
    const id = await deps.notify({ ...texts(reminder), at: new Date(reminder.at), entryId: reminder.entryId });
    if (id !== null) next[key] = id;
  }
  deps.save(next);
}

const readJson = <T>(key: string, fallback: T): T => {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? "null") as T) ?? fallback;
  } catch {
    return fallback;
  }
};

const deviceDeps: AppointmentReminderDeps = {
  permission: getNotificationPermission,
  notify,
  cancel: cancelNotification,
  pending: pendingNotificationIds,
  load: () => readJson<ScheduledAppointmentReminders>(STORAGE_KEY, {}),
  save: (scheduled) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(scheduled));
    } catch {
      // Private mode or full storage: done again next time.
    }
  },
};

/** Reconciles this device's appointment reminders. */
export function reconcileAppointmentReminders(appointments: Appointment[] | null, texts: (reminder: AppointmentReminder) => Texts, enabled: boolean) {
  return reconcileAppointmentReminderState(appointments, texts, deviceDeps, { enabled }).catch(() => undefined);
}
