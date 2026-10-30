import { useSyncExternalStore } from "react";
import { loanReminders, type LoanReminder } from "@/lib/loanReminders";
import type { Loan } from "@/lib/loans";
import { cancelNotification, getNotificationPermission, notify, pendingNotificationIds } from "./notifications";

// The due-day reminders of "Prêts" (Android app only, lib/loanReminders.ts).
// The setting is this device's, like its notifications, on by default.
// Rescheduled when the app opens and at each change of a loan
// (LoanReminderKeeper). Nothing on the server: the cron doesn't read loans.

export { LOAN_NOTIFICATION_PREFIX } from "@/lib/loanReminders";

const SETTING_KEY = "loan-reminders.v1";
const STORAGE_KEY = "loan-reminders-scheduled.v1";

/** What this device has scheduled, by reminder key. */
export type ScheduledLoanReminders = Record<string, number>;

type Texts = { title: string; body: string };

export type LoanReminderDeps = {
  permission: () => Promise<string>;
  notify: (options: Texts & { at: Date; entryId: string }) => Promise<number | null>;
  cancel: (id: number) => Promise<void>;
  pending: () => Promise<Set<number> | null>;
  load: () => ScheduledLoanReminders;
  save: (scheduled: ScheduledLoanReminders) => void;
};

/**
 * Brings the scheduled reminders in line with the loans, the setting and the
 * plan: cancels the ones no longer wanted (all of them once switched off),
 * schedules the missing ones. Never asks for permission.
 */
export async function reconcileLoanReminderState(
  loans: Loan[],
  texts: (reminder: LoanReminder) => Texts,
  deps: LoanReminderDeps,
  { enabled = true, now = Date.now() }: { enabled?: boolean; now?: number } = {},
) {
  const scheduled = deps.load();
  const wanted = new Map(loanReminders(loans, now, enabled).map((reminder) => [reminder.key, reminder]));
  // Switched off: cancelled even without the permission (nothing to keep).
  if (wanted.size > 0 && (await deps.permission()) !== "granted") return;
  const pending = wanted.size > 0 ? await deps.pending() : null;
  const next: ScheduledLoanReminders = {};
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

const writeJson = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or full storage: done again next time.
  }
};

const deviceDeps: LoanReminderDeps = {
  permission: getNotificationPermission,
  notify,
  cancel: cancelNotification,
  pending: pendingNotificationIds,
  load: () => readJson<ScheduledLoanReminders>(STORAGE_KEY, {}),
  save: (scheduled) => writeJson(STORAGE_KEY, scheduled),
};

/** Reconciles this device's loan reminders. */
export function reconcileLoanReminders(loans: Loan[], texts: (reminder: LoanReminder) => Texts, enabled: boolean) {
  return reconcileLoanReminderState(loans, texts, deviceDeps, { enabled }).catch(() => undefined);
}

// ---- The setting ("Me rappeler les échéances") ---------------------------------------

const listeners = new Set<() => void>();
let cached: boolean | null = null;

function read() {
  if (cached === null) cached = readJson<{ on?: boolean }>(SETTING_KEY, {}).on !== false;
  return cached;
}

export const loanReminderSetting = {
  get: read,
  set(on: boolean) {
    cached = on;
    writeJson(SETTING_KEY, { on });
    listeners.forEach((listener) => listener());
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** On by default; the default on the server and at hydration. */
export const useLoanReminderSetting = () => useSyncExternalStore(loanReminderSetting.subscribe, read, () => true);
