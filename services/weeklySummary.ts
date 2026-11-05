import { cancelNotification, getNotificationPermission, notify, pendingNotificationIds } from "./notifications";

// The Sunday summary notification ("Ta semaine", Android app only): one local
// notification for the coming Sunday, its text made from the data of the
// device. It is scheduled again whenever the text changes (WeeklySummaryKeeper
// calls this at app start and at each change), so it says what the app knew
// last. Nothing leaves the device.

/** Tapped, it opens the home screen, where the "Ta semaine" card is (services/notificationTap.ts). */
export const WEEKLY_ENTRY_ID = "weekly-summary";

const STORAGE_KEY = "weekly-summary-scheduled.v1";

/** What this device has scheduled. */
export type ScheduledWeekly = { id: number; at: number; body: string };

type Texts = { title: string; body: string };

export type WeeklyDeps = {
  permission: () => Promise<string>;
  notify: (options: Texts & { at: Date; entryId: string }) => Promise<number | null>;
  cancel: (id: number) => Promise<void>;
  pending: () => Promise<Set<number> | null>;
  load: () => ScheduledWeekly | null;
  save: (scheduled: ScheduledWeekly | null) => void;
};

/**
 * Brings the scheduled summary in line with what is wanted: `null` cancels it
 * (switched off, no plan, nothing to tell); otherwise it is scheduled, or
 * rescheduled when its day or text changed. Never asks for permission.
 */
export async function reconcileWeeklyState(wanted: ({ at: number } & Texts) | null, deps: WeeklyDeps) {
  const scheduled = deps.load();
  if (!wanted) {
    if (scheduled) await deps.cancel(scheduled.id);
    if (scheduled) deps.save(null);
    return;
  }
  if ((await deps.permission()) !== "granted") return;
  if (scheduled && scheduled.at === wanted.at && scheduled.body === wanted.body) {
    const pending = await deps.pending();
    if (!pending || pending.has(scheduled.id)) return;
  }
  if (scheduled) await deps.cancel(scheduled.id);
  const id = await deps.notify({ title: wanted.title, body: wanted.body, at: new Date(wanted.at), entryId: WEEKLY_ENTRY_ID });
  deps.save(id === null ? null : { id, at: wanted.at, body: wanted.body });
}

const deviceDeps: WeeklyDeps = {
  permission: getNotificationPermission,
  notify,
  cancel: cancelNotification,
  pending: pendingNotificationIds,
  load: () => {
    try {
      return (JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as ScheduledWeekly | null) ?? null;
    } catch {
      return null;
    }
  },
  save: (scheduled) => {
    try {
      if (scheduled) localStorage.setItem(STORAGE_KEY, JSON.stringify(scheduled));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Private mode or full storage: done again next time.
    }
  },
};

/** Reconciles this device's Sunday summary. */
export function reconcileWeekly(wanted: ({ at: number } & Texts) | null) {
  return reconcileWeeklyState(wanted, deviceDeps).catch(() => undefined);
}
