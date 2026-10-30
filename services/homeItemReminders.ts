import { plannedWarrantyReminders, type HomeItem } from "@/lib/inventory";
import { homeItemStore } from "./homeItemStore";
import { cancelNotification, getNotificationPermission, notify, pendingNotificationIds } from "./notifications";

// "Ma maison" reminders: one local notification per thing, 30 days before its
// warranty ends ("La garantie de ton frigo finit le 12 mars"). The ids
// scheduled on this device are kept here, not in the item (they are
// meaningless on another device). Same scheme as vehicleReminders.

/** Marks a tapped notification as a home item's: it opens "Ma maison". */
export const HOME_ITEM_NOTIFICATION_PREFIX = "home:";

const STORAGE_KEY = "home-reminders.v1";

/** What this device has scheduled, by item id. */
export type ScheduledHomeReminders = Record<string, { id: number; at: number; text: string }>;

type Texts = { title: string; body: string };

export type HomeReminderDeps = {
  permission: () => Promise<string>;
  notify: (options: Texts & { at: Date; entryId: string }) => Promise<number | null>;
  cancel: (id: number) => Promise<void>;
  /** Ids still to come; null when unknown (then the saved state is trusted). */
  pending: () => Promise<Set<number> | null>;
  load: () => ScheduledHomeReminders;
  save: (scheduled: ScheduledHomeReminders) => void;
};

/** The notification's texts, from the item and the day its warranty ends. */
export type HomeReminderTexts = (item: HomeItem, endsAt: number) => Texts;

/**
 * Brings the scheduled notifications in line with the items and the plan:
 * cancels the ones no longer wanted (item removed, date or text changed, plan
 * without "Ma maison" or without reminders) and schedules the missing ones.
 * Never asks for permission: without it, nothing happens.
 */
export async function reconcileHomeReminderState(
  items: HomeItem[],
  texts: HomeReminderTexts,
  deps: HomeReminderDeps,
  { enabled = true, now = Date.now() }: { enabled?: boolean; now?: number } = {},
) {
  if ((await deps.permission()) !== "granted") return;
  const planned = plannedWarrantyReminders(items, now, enabled);
  const scheduled = deps.load();
  const pending = await deps.pending();
  const next: ScheduledHomeReminders = {};

  for (const [key, current] of Object.entries(scheduled)) {
    const wanted = planned.get(key);
    const stillThere = !pending || pending.has(current.id);
    const text = wanted && texts(wanted.item, wanted.endsAt);
    if (wanted && text && stillThere && wanted.at === current.at && text.body === current.text) next[key] = current;
    else await deps.cancel(current.id);
  }

  for (const [key, { item, at, endsAt }] of planned) {
    if (next[key]) continue;
    const text = texts(item, endsAt);
    const id = await deps.notify({ ...text, at: new Date(at), entryId: HOME_ITEM_NOTIFICATION_PREFIX + item.id });
    if (id !== null) next[key] = { id, at, text: text.body };
  }

  deps.save(next);
}

const deviceDeps: HomeReminderDeps = {
  permission: getNotificationPermission,
  notify,
  cancel: cancelNotification,
  pending: pendingNotificationIds,
  load: () => {
    try {
      return (JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as ScheduledHomeReminders) ?? {};
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

/** Reconciles this device's warranty notifications; calls made meanwhile run once after. */
export function reconcileHomeReminders(texts: HomeReminderTexts, enabled: boolean) {
  const run = async () => reconcileHomeReminderState(await homeItemStore.list(), texts, deviceDeps, { enabled }).catch(() => undefined);
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
