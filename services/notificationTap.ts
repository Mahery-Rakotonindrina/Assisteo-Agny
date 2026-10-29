import { EVENING_ENTRY_ID } from "./eveningReminder";
import { EXPENSE_NOTIFICATION_PREFIX } from "./expenseReminders";
import { PARCEL_NOTIFICATION_PREFIX } from "./parcelReminders";
import { isSnoozeAction } from "./reminders";
import { VEHICLE_NOTIFICATION_PREFIX } from "./vehicleReminders";

// What a tapped local notification does. One listener only (useNativeBootstrap):
// when Android had closed the app, Capacitor hands the retained tap to the
// first listener alone, so the snooze buttons must be handled there too.

export type TapTarget = { pathname: string; query?: Record<string, string> };

type TapActions = {
  /** Puts the reminder off; the new time, or null when it couldn't be done. */
  snooze: (entryId: string, actionId: string, notificationId: number) => Promise<number | null>;
  open: (target: TapTarget) => void;
  snoozed?: (at: number) => void;
};

/** Where the notification itself leads: "Mes colis", the vehicle in "Mon garage", "Mes dépenses" (the add form for the evening one), or the scan offering "remind me later". */
export function tapTarget(entryId: string): TapTarget {
  if (entryId.startsWith(PARCEL_NOTIFICATION_PREFIX)) return { pathname: "/parcels" };
  if (entryId.startsWith(VEHICLE_NOTIFICATION_PREFIX)) return { pathname: "/garage", query: { open: entryId.slice(VEHICLE_NOTIFICATION_PREFIX.length) } };
  if (entryId === EVENING_ENTRY_ID) return { pathname: "/expenses", query: { add: "expense" } };
  if (entryId.startsWith(EXPENSE_NOTIFICATION_PREFIX)) return { pathname: "/expenses" };
  return { pathname: "/result", query: { id: entryId, reminded: "1" } };
}

/**
 * "In 1 h" / "Tomorrow" buttons put the reminder off without opening the scan
 * (the entry is read from storage, so it works on a cold start too); if that
 * fails, the scan opens so nothing is silently lost. Anything else opens.
 */
export async function handleNotificationTap(entryId: string, actionId: string, notificationId: number, actions: TapActions) {
  const isScan = ![PARCEL_NOTIFICATION_PREFIX, VEHICLE_NOTIFICATION_PREFIX, EXPENSE_NOTIFICATION_PREFIX].some((prefix) => entryId.startsWith(prefix));
  if (isSnoozeAction(actionId) && isScan) {
    const at = await actions.snooze(entryId, actionId, notificationId).catch(() => null);
    if (at !== null) {
      actions.snoozed?.(at);
      return;
    }
  }
  actions.open(tapTarget(entryId));
}
