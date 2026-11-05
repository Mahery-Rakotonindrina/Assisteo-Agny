import { doseKey, doseReminders, type DoseReminder, type MedicationPlan } from "@/lib/medication";
import { cancelNotification, getNotificationPermission, notify, pendingNotificationIds } from "./notifications";
import { historyStore } from "./historyStore";

// Doses to take (a scanned prescription or medicine box): one local
// notification per moment of the next 7 days (lib/medication.ts), again when
// the app opens and at each change (MedicationReminderKeeper). Same scheme as
// the watering reminders; the ids are this device's.

/** Tapped, it opens the scan (services/notificationTap.ts): "med:<scan id>". */
export const MEDICATION_NOTIFICATION_PREFIX = "med:";

const STORAGE_KEY = "medication-doses.v1";

/** What this device has scheduled, by scan and moment. */
export type ScheduledDoses = Record<string, { id: number; text: string }>;

type Texts = { title: string; body: string };

export type MedicationReminderDeps = {
  permission: () => Promise<string>;
  notify: (options: Texts & { at: Date; entryId: string }) => Promise<number | null>;
  cancel: (id: number) => Promise<void>;
  /** Ids still to come; null when unknown (then the saved state is trusted). */
  pending: () => Promise<Set<number> | null>;
  load: () => ScheduledDoses;
  save: (scheduled: ScheduledDoses) => void;
};

/** What a dose's notification says. */
export type MedicationReminderTexts = (reminder: DoseReminder) => Texts;

/**
 * Brings the scheduled doses in line with the plans and the plan of the
 * account: cancels those no longer wanted (all of them without the
 * reminders), or whose text changed, and schedules the missing ones. Never
 * asks for permission.
 */
export async function reconcileMedicationState(
  entries: Array<{ id: string; medication?: MedicationPlan }>,
  texts: MedicationReminderTexts,
  deps: MedicationReminderDeps,
  { enabled = true, now = Date.now() }: { enabled?: boolean; now?: number } = {},
) {
  const scheduled = deps.load();
  const wanted = new Map(doseReminders(entries, now, enabled).map((reminder) => [doseKey(reminder.entryId, reminder.at), { reminder, text: texts(reminder) }]));
  // Nothing wanted: cancelled even without the permission (nothing to keep).
  if (wanted.size > 0 && (await deps.permission()) !== "granted") return;
  const pending = wanted.size > 0 ? await deps.pending() : null;
  const next: ScheduledDoses = {};
  for (const [key, current] of Object.entries(scheduled)) {
    const dose = wanted.get(key);
    if (dose && dose.text.body === current.text && (!pending || pending.has(current.id))) next[key] = current;
    else await deps.cancel(current.id);
  }
  for (const [key, { reminder, text }] of wanted) {
    if (next[key]) continue;
    const id = await deps.notify({ ...text, at: new Date(reminder.at), entryId: `${MEDICATION_NOTIFICATION_PREFIX}${reminder.entryId}` });
    if (id !== null) next[key] = { id, text: text.body };
  }
  deps.save(next);
}

const deviceDeps: MedicationReminderDeps = {
  permission: getNotificationPermission,
  notify,
  cancel: cancelNotification,
  pending: pendingNotificationIds,
  load: () => {
    try {
      return (JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as ScheduledDoses) ?? {};
    } catch {
      return {};
    }
  },
  save: (scheduled) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(scheduled));
    } catch {
      // Private mode or full storage: scheduled again next time.
    }
  },
};

let running: Promise<void> | null = null;
let again: (() => Promise<void>) | null = null;

/** Reconciles this device's dose notifications; calls made meanwhile run once after. */
export function reconcileMedicationReminders(texts: MedicationReminderTexts, enabled: boolean) {
  const run = async () => reconcileMedicationState(await historyStore.list(), texts, deviceDeps, { enabled }).catch(() => undefined);
  if (running) {
    again = run;
    return running;
  }
  running = (async () => {
    try {
      await run();
      while (again) {
        const next = again;
        again = null;
        await next();
      }
    } finally {
      running = null;
    }
  })();
  return running;
}
