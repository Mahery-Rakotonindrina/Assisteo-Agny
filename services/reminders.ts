import type { Analysis } from "@/lib/ai/schema";
import { makeRepeat, nextOccurrence, previousOccurrence, snoozeAt, type RepeatEvery, type SnoozeChoice } from "@/lib/reminderRepeat";
import type { HistoryEntry } from "@/types/history";
import { historyStore } from "./historyStore";
import {
  cancelNotification,
  dismissNotification,
  getNotificationPermission,
  notify,
  registerNotificationActions,
  REMINDER_ACTION_TYPE,
  requestNotificationPermission,
} from "./notifications";
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

type ScheduleOptions = {
  /** Ask for the notification permission if needed (not from background work). */
  ask?: boolean;
  /**
   * Sets how the reminder repeats from `at` (null: once). Left out, the
   * repetition is kept: a snooze only moves this occurrence.
   */
  repeat?: RepeatEvery | null;
};

/** Schedules (or moves) this entry's reminder. Returns false without permission. */
export async function scheduleReminder(entry: HistoryEntry, at: number, texts: Texts, { ask = true, repeat }: ScheduleOptions = {}) {
  const permission = ask ? await requestNotificationPermission() : await getNotificationPermission();
  if (permission !== "granted") return false;
  if (entry.reminderId) await cancelNotification(entry.reminderId);
  const reminderId = await notify({ ...texts, at: new Date(at), entryId: entry.id, actionTypeId: REMINDER_ACTION_TYPE });
  if (reminderId === null) return false;
  await historyStore.update(entry.id, {
    reminderId,
    reminderAt: at,
    reminderScheduledAt: at,
    reminderFiredAt: undefined,
    ...(repeat !== undefined && { reminderRepeat: repeat ? makeRepeat(repeat, at) : undefined }),
  });
  return true;
}

export async function cancelReminder(entry: HistoryEntry) {
  if (entry.reminderId) await cancelNotification(entry.reminderId);
  await historyStore.update(entry.id, { reminderId: undefined, reminderAt: undefined, reminderScheduledAt: undefined, reminderRepeat: undefined, reminderFiredAt: undefined });
}

/**
 * When this reminder came, if within the last day and not put off since;
 * null otherwise, and always for the mandatory insurance one. A recurring
 * reminder has already moved on: the occurrence that came is the one kept by
 * advanceRecurring, or (moved on by the server) the one before its next.
 */
export function arrivedAt(entry: HistoryEntry, now = Date.now()) {
  if (!entry.reminderAt || isForced(entry)) return null;
  const recent = (at: number | null | undefined) => (at && at <= now && at > now - DAY ? at : null);
  if (entry.reminderAt <= now) return recent(entry.reminderAt);
  if (!entry.reminderRepeat) return null;
  if (entry.reminderFiredAt) return recent(entry.reminderFiredAt);
  // Not the regular next occurrence: put off already.
  if (entry.reminderAt !== nextOccurrence(entry.reminderRepeat, now)) return null;
  return recent(previousOccurrence(entry.reminderRepeat, entry.reminderAt));
}

/** A reminder that has come (within the last day) and can be put off. */
export const canSnooze = (entry: HistoryEntry, now = Date.now()) => arrivedAt(entry, now) !== null;

/**
 * "Remind me later": moves this occurrence only; a recurring reminder keeps
 * its next ones on the original day. Returns the new time, or null without permission.
 */
export async function snoozeReminder(entry: HistoryEntry, choice: SnoozeChoice, texts: Texts, { ask = true } = {}) {
  const at = snoozeAt(choice, Date.now());
  return (await scheduleReminder(entry, at, texts, { ask })) ? at : null;
}

/** Notification buttons: their ids, and the snooze each one means. */
const SNOOZE_ACTIONS: Record<string, SnoozeChoice> = { "snooze-hour": "hour", "snooze-tomorrow": "tomorrow" };

/** Registers the "in 1 h" and "tomorrow" buttons of reminder notifications, in the user's language. */
export function registerReminderActions(titles: Record<"hour" | "tomorrow", string>) {
  return registerNotificationActions(REMINDER_ACTION_TYPE, [
    { id: "snooze-hour", title: titles.hour },
    { id: "snooze-tomorrow", title: titles.tomorrow },
  ]);
}

export const isSnoozeAction = (actionId: string) => Object.hasOwn(SNOOZE_ACTIONS, actionId);

/** One of the notification's buttons was used: put the reminder off without opening the scan. */
export async function snoozeFromNotification(entryId: string, actionId: string, notificationId: number, texts: (entry: HistoryEntry) => Texts) {
  if (!isSnoozeAction(actionId)) return null;
  const choice = SNOOZE_ACTIONS[actionId];
  await dismissNotification(notificationId);
  const entry = await historyStore.get(entryId);
  if (!entry || isForced(entry)) return null;
  return snoozeReminder(entry, choice, texts(entry), { ask: false });
}

/**
 * Moves a recurring reminder whose time has passed to its next occurrence.
 * Returns how many moved. Runs without notification permission too, so the
 * "next reminder" card stays right.
 */
export async function advanceRecurring(entries: HistoryEntry[], now = Date.now()) {
  let moved = 0;
  for (const entry of entries) {
    if (!entry.reminderRepeat || !entry.reminderAt || entry.reminderAt > now || isForced(entry)) continue;
    const next = nextOccurrence(entry.reminderRepeat, now);
    // The occurrence that came stays one day for "remind me later".
    await historyStore.update(entry.id, { reminderAt: next, reminderFiredAt: entry.reminderAt });
    moved += 1;
  }
  return moved;
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
      const now = Date.now();
      // The next month (or year) of a recurring reminder, even if the app wasn't opened in between.
      await advanceRecurring(await historyStore.list(), now);
      if ((await getNotificationPermission()) !== "granted") return;
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
          const reminderId = await notify({ ...text, at: new Date(wanted), entryId: entry.id, actionTypeId: REMINDER_ACTION_TYPE });
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
