import { canTake, doseReminders, reminderKey, withTaken, type DoseReminder, type MedicationPlan } from "@/lib/medication";
import { cancelNotification, dismissNotification, getNotificationPermission, notify, pendingNotificationIds, registerNotificationActions } from "./notifications";
import { historyStore } from "./historyStore";

// Doses to take (a scanned prescription or medicine box): one local
// notification per moment of the next 7 days (lib/medication.ts), again when
// the app opens and at each change (MedicationReminderKeeper). Same scheme as
// the watering reminders; the ids are this device's.

/** Tapped, it opens "Ma santé" (services/notificationTap.ts): "med:<scan id>@<dose moment>", or "med:<scan id>". */
export const MEDICATION_NOTIFICATION_PREFIX = "med:";

/** The dose notifications' button: "J'ai pris" (Android app). */
export const MEDICATION_ACTION_TYPE = "medication";
export const TAKEN_ACTION = "taken";

/** Registers the "J'ai pris" button, in the user's language. */
export const registerMedicationActions = (title: string) => registerNotificationActions(MEDICATION_ACTION_TYPE, [{ id: TAKEN_ACTION, title }]);

/** The scan and the dose moment of a dose notification's link (older links: the scan alone). */
export function medicationLink(entryId: string) {
  if (!entryId.startsWith(MEDICATION_NOTIFICATION_PREFIX)) return null;
  const [scanId, at] = entryId.slice(MEDICATION_NOTIFICATION_PREFIX.length).split("@");
  const moment = Number(at);
  return { scanId, at: at && Number.isFinite(moment) ? moment : null };
}

/**
 * "J'ai pris": this moment of the scan's plan is ticked (on the screen, or
 * from the notification): a dose gone by or within the hour, never later. Its
 * notification is then cancelled (the keeper reconciles on the change).
 */
export async function markDoseTaken(scanId: string, at: number, now = Date.now()) {
  if (!canTake(at, now)) return false;
  const entry = await historyStore.get(scanId);
  if (!entry?.medication) return false;
  await historyStore.update(scanId, { medication: withTaken(entry.medication, at) });
  return true;
}

/** The notification's "J'ai pris" button: ticked without opening the app's screen, the notification taken away. */
export async function takenFromNotification(entryId: string, notificationId: number) {
  const link = medicationLink(entryId);
  if (!link || link.at === null) return false;
  const done = await markDoseTaken(link.scanId, link.at);
  if (done) await dismissNotification(notificationId);
  return done;
}

const STORAGE_KEY = "medication-doses.v1";

/** What this device has scheduled, by scan and moment. */
export type ScheduledDoses = Record<string, { id: number; text: string }>;

type Texts = { title: string; body: string };

export type MedicationReminderDeps = {
  permission: () => Promise<string>;
  notify: (options: Texts & { at: Date; entryId: string; actionTypeId?: string }) => Promise<number | null>;
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
  const wanted = new Map(doseReminders(entries, now, enabled).map((reminder) => [reminderKey(reminder), { reminder, text: texts(reminder) }]));
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
    // A dose: its moment in the link, for its "J'ai pris" button. The last-day notice: the scan alone.
    const id = await deps.notify({
      ...text,
      at: new Date(reminder.at),
      entryId: reminder.kind === "lastDay" ? `${MEDICATION_NOTIFICATION_PREFIX}${reminder.entryId}` : `${MEDICATION_NOTIFICATION_PREFIX}${reminder.entryId}@${reminder.at}`,
      ...(reminder.kind !== "lastDay" && { actionTypeId: MEDICATION_ACTION_TYPE }),
    });
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
