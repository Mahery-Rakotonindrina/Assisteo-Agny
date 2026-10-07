import type { Analysis } from "@/lib/ai/schema";
import type { HistoryEntry } from "@/types/history";
import { historyStore } from "./historyStore";
import { cancelNotification, getNotificationPermission, notify, requestNotificationPermission } from "./notifications";
import { reportScheduledReminders } from "./push";

// Reminders are local notifications, scheduled per device. The history keeps
// the intended time (reminderAt, synced with the account); each device keeps
// its own notification id (reminderId) and reconciles the two.

/** Insurance reminders are not optional: they fire this long before expiry. */
export const INSURANCE_NOTICE_DAYS = 5;
const INSURANCE_NOTICE_HOUR = 9;
const DAY = 86_400_000;

/** Parses a YYYY-MM-DD date as local midnight; null when absent or invalid. */
function parseDay(value: string | null | undefined) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * When the mandatory insurance reminder fires: 9:00, five days before the
 * expiry date. If that moment has passed but the policy hasn't expired yet,
 * remind right away. Null for anything that isn't a dated insurance document.
 */
export function insuranceReminderAt(analysis: Analysis, now = Date.now()) {
  if (!analysis.document?.isInsurance) return null;
  const expiry = parseDay(analysis.document.expiresOn);
  if (!expiry) return null;
  const endOfExpiryDay = expiry.getTime() + DAY;
  if (endOfExpiryDay <= now) return null;
  const notice = new Date(expiry.getTime() - INSURANCE_NOTICE_DAYS * DAY);
  notice.setHours(INSURANCE_NOTICE_HOUR, 0, 0, 0);
  return notice.getTime() > now ? notice.getTime() : now + 60_000;
}

export function expiryDate(analysis: Analysis) {
  return parseDay(analysis.document?.expiresOn)?.getTime() ?? null;
}

export function isForced(entry: HistoryEntry) {
  return insuranceReminderAt(entry.analysis) !== null;
}

/** What the notification says, from the AI's suggestion or the scan itself. */
export function reminderText(entry: HistoryEntry, fallbackBody: string) {
  return {
    title: entry.analysis.reminder?.title ?? entry.analysis.title,
    body: entry.analysis.reminder?.body ?? fallbackBody,
  };
}

type Texts = { title: string; body: string };

/** Schedules (or moves) this entry's reminder. Returns false without permission. */
export async function scheduleReminder(entry: HistoryEntry, at: number, texts: Texts, { ask = true } = {}) {
  const permission = ask ? await requestNotificationPermission() : await getNotificationPermission();
  if (permission !== "granted") return false;
  if (entry.reminderId) await cancelNotification(entry.reminderId);
  const reminderId = await notify({ ...texts, at: new Date(at), entryId: entry.id });
  if (reminderId === null) return false;
  await historyStore.update(entry.id, { reminderId, reminderAt: at, reminderScheduledAt: at });
  return true;
}

export async function cancelReminder(entry: HistoryEntry) {
  if (entry.reminderId) await cancelNotification(entry.reminderId);
  await historyStore.update(entry.id, { reminderId: undefined, reminderAt: undefined, reminderScheduledAt: undefined });
}

let reconciling: Promise<void> | null = null;

/**
 * Brings this device's notifications in line with the history:
 * - insurance documents always get their 5-day notice;
 * - a reminder set (or moved) on another device gets scheduled here too;
 * - a reminder removed elsewhere is cancelled here.
 * Never prompts for permission: it only acts where notifications are allowed.
 */
export function reconcileReminders(texts: { insurance: (entry: HistoryEntry) => Texts; other: (entry: HistoryEntry) => Texts }) {
  reconciling ??= (async () => {
    try {
      if ((await getNotificationPermission()) !== "granted") return;
      const now = Date.now();
      for (const entry of await historyStore.list()) {
        const forcedAt = insuranceReminderAt(entry.analysis, now);
        if (forcedAt !== null && entry.reminderAt !== forcedAt) {
          await scheduleReminder(entry, forcedAt, texts.insurance(entry), { ask: false });
          continue;
        }
        const wanted = entry.reminderAt && entry.reminderAt > now ? entry.reminderAt : null;
        if (wanted && (!entry.reminderId || entry.reminderScheduledAt !== wanted)) {
          if (entry.reminderId) await cancelNotification(entry.reminderId);
          const text = forcedAt !== null ? texts.insurance(entry) : texts.other(entry);
          const reminderId = await notify({ ...text, at: new Date(wanted), entryId: entry.id });
          // Device-local fields only: rawPut keeps the entry's sync state untouched.
          const latest = await historyStore.rawGet(entry.id);
          if (latest && reminderId !== null) await historyStore.rawPut({ ...latest, reminderId, reminderScheduledAt: wanted }, { silent: true });
        } else if (!wanted && entry.reminderId) {
          await cancelNotification(entry.reminderId);
          const latest = await historyStore.rawGet(entry.id);
          if (latest) await historyStore.rawPut({ ...latest, reminderId: undefined, reminderScheduledAt: undefined }, { silent: true });
        }
      }
      // The server pushes only the reminders this device doesn't hold.
      await reportScheduledReminders().catch(() => undefined);
    } finally {
      reconciling = null;
    }
  })();
  return reconciling;
}
