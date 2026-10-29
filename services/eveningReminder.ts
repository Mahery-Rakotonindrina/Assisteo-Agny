import { useSyncExternalStore } from "react";
import { defaultEvening, eveningKey, eveningTimes, type EveningSetting } from "@/lib/eveningReminder";
import type { ExpenseRecord } from "@/lib/expenses";
import { EXPENSE_NOTIFICATION_PREFIX } from "./expenseReminders";
import { cancelNotification, getNotificationPermission, notify, pendingNotificationIds } from "./notifications";

// The evening reminder of "Mes dépenses" (Android app only): the setting is
// this device's, like its notifications. The next 7 evenings are scheduled
// one by one (lib/eveningReminder.ts), again when the app opens and at each
// expense (ExpenseReminderKeeper).

/** Tapped, it opens "Mes dépenses" with the add form (services/notificationTap.ts). */
export const EVENING_ENTRY_ID = `${EXPENSE_NOTIFICATION_PREFIX}evening`;

const SETTING_KEY = "expense-evening.v1";
const STORAGE_KEY = "expense-evening-scheduled.v1";

/** What this device has scheduled, by day ("2026-10-29"). */
export type ScheduledEvenings = Record<string, { id: number; at: number }>;

type Texts = { title: string; body: string };

export type EveningDeps = {
  permission: () => Promise<string>;
  notify: (options: Texts & { at: Date; entryId: string }) => Promise<number | null>;
  cancel: (id: number) => Promise<void>;
  pending: () => Promise<Set<number> | null>;
  load: () => ScheduledEvenings;
  save: (scheduled: ScheduledEvenings) => void;
};

/**
 * Brings the scheduled evenings in line with the setting, the plan and the
 * expenses noted: cancels the evenings no longer wanted (all of them once
 * switched off), schedules the missing ones. Never asks for permission.
 */
export async function reconcileEveningState(
  records: ExpenseRecord[],
  setting: EveningSetting,
  texts: Texts,
  deps: EveningDeps,
  { enabled = true, now = Date.now() }: { enabled?: boolean; now?: number } = {},
) {
  const scheduled = deps.load();
  const wanted = new Map(eveningTimes(records, setting, now, enabled).map((at) => [eveningKey(at), at]));
  // Switched off: cancelled even without the permission (nothing to keep).
  if (wanted.size > 0 && (await deps.permission()) !== "granted") return;
  const pending = wanted.size > 0 ? await deps.pending() : null;
  const next: ScheduledEvenings = {};
  for (const [key, current] of Object.entries(scheduled)) {
    if (wanted.get(key) === current.at && (!pending || pending.has(current.id))) next[key] = current;
    else await deps.cancel(current.id);
  }
  for (const [key, at] of wanted) {
    if (next[key]) continue;
    const id = await deps.notify({ ...texts, at: new Date(at), entryId: EVENING_ENTRY_ID });
    if (id !== null) next[key] = { id, at };
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

const writeJson = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or full storage: done again next time.
  }
};

const deviceDeps: EveningDeps = {
  permission: getNotificationPermission,
  notify,
  cancel: cancelNotification,
  pending: pendingNotificationIds,
  load: () => readJson<ScheduledEvenings>(STORAGE_KEY, {}),
  save: (scheduled) => writeJson(STORAGE_KEY, scheduled),
};

/** Reconciles this device's evening reminders. */
export function reconcileEvenings(records: ExpenseRecord[], setting: EveningSetting, texts: Texts, enabled: boolean) {
  return reconcileEveningState(records, setting, texts, deviceDeps, { enabled }).catch(() => undefined);
}

// ---- The setting ------------------------------------------------------------------

const listeners = new Set<() => void>();
let cached: EveningSetting | null = null;

function read(): EveningSetting {
  if (cached) return cached;
  const saved = readJson<Partial<EveningSetting>>(SETTING_KEY, {});
  cached = { ...defaultEvening, ...saved };
  return cached;
}

export const eveningSetting = {
  get: read,
  set(setting: EveningSetting) {
    cached = setting;
    writeJson(SETTING_KEY, setting);
    listeners.forEach((listener) => listener());
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** The device's evening setting; the default one on the server and at hydration. */
export const useEveningSetting = () => useSyncExternalStore(eveningSetting.subscribe, read, () => defaultEvening);
