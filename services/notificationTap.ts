import { PARCEL_NOTIFICATION_PREFIX } from "./parcelReminders";
import { isSnoozeAction } from "./reminders";

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

/** Where the notification itself leads: "Mes colis", or the scan offering "remind me later". */
export function tapTarget(entryId: string): TapTarget {
  if (entryId.startsWith(PARCEL_NOTIFICATION_PREFIX)) return { pathname: "/parcels" };
  return { pathname: "/result", query: { id: entryId, reminded: "1" } };
}

/**
 * "In 1 h" / "Tomorrow" buttons put the reminder off without opening the scan
 * (the entry is read from storage, so it works on a cold start too); if that
 * fails, the scan opens so nothing is silently lost. Anything else opens.
 */
export async function handleNotificationTap(entryId: string, actionId: string, notificationId: number, actions: TapActions) {
  if (isSnoozeAction(actionId) && !entryId.startsWith(PARCEL_NOTIFICATION_PREFIX)) {
    const at = await actions.snooze(entryId, actionId, notificationId).catch(() => null);
    if (at !== null) {
      actions.snoozed?.(at);
      return;
    }
  }
  actions.open(tapTarget(entryId));
}
