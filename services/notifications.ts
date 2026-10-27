import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

// Local notifications only: nothing leaves the device. On the web the plugin
// falls back to the Notification API.

export type NotificationPermission = "granted" | "denied" | "prompt" | "unsupported";

function isSupported() {
  return Capacitor.isNativePlatform() || (typeof window !== "undefined" && "Notification" in window);
}

export async function getNotificationPermission(): Promise<NotificationPermission> {
  if (!isSupported()) return "unsupported";
  const { display } = await LocalNotifications.checkPermissions();
  return display === "granted" ? "granted" : display === "denied" ? "denied" : "prompt";
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isSupported()) return "unsupported";
  const { display } = await LocalNotifications.requestPermissions();
  return display === "granted" ? "granted" : display === "denied" ? "denied" : "prompt";
}

// Notification ids must be 32-bit ints on Android.
function nextId() {
  return Math.floor(Date.now() % 2_000_000_000) + Math.floor(Math.random() * 1000);
}

/** The action type of scan reminders: "in 1 h" and "tomorrow" buttons (see services/reminders.ts). */
export const REMINDER_ACTION_TYPE = "reminder";

type NotifyOptions = {
  title: string;
  body: string;
  /** Deliver later instead of now. */
  at?: Date;
  /** History entry to open when the notification is tapped (or a parcel, see parcelReminders). */
  entryId?: string;
  /** Buttons shown on the notification (Android app), registered with registerNotificationActions. */
  actionTypeId?: string;
};

export async function notify({ title, body, at, entryId, actionTypeId }: NotifyOptions): Promise<number | null> {
  if ((await getNotificationPermission()) !== "granted") return null;

  const id = nextId();
  await LocalNotifications.schedule({
    notifications: [
      {
        id,
        title,
        body,
        extra: entryId ? { entryId } : undefined,
        ...(actionTypeId && Capacitor.isNativePlatform() && { actionTypeId }),
        ...(at && { schedule: { at, allowWhileIdle: true } }),
      },
    ],
  });
  return id;
}

export async function cancelNotification(id: number) {
  await LocalNotifications.cancel({ notifications: [{ id }] }).catch(() => undefined);
}

/** Ids of the notifications still to come; null when the plugin can't tell. */
export async function pendingNotificationIds(): Promise<Set<number> | null> {
  if (!isSupported()) return null;
  try {
    const { notifications } = await LocalNotifications.getPending();
    return new Set(notifications.map(({ id }) => id));
  } catch {
    return null;
  }
}

/** Cancels every pending notification (account deleted). */
export async function cancelAllNotifications() {
  if (!isSupported()) return;
  const { notifications } = await LocalNotifications.getPending().catch(() => ({ notifications: [] }));
  if (notifications.length) await LocalNotifications.cancel({ notifications: notifications.map(({ id }) => ({ id })) }).catch(() => undefined);
}

/** Buttons for the notifications of this type (native apps only; the web shows none). */
export async function registerNotificationActions(typeId: string, actions: Array<{ id: string; title: string }>) {
  if (!Capacitor.isNativePlatform()) return;
  await LocalNotifications.registerActionTypes({ types: [{ id: typeId, actions }] }).catch(() => undefined);
}

/** Takes a shown notification off the screen (after one of its buttons was used). */
export async function dismissNotification(id: number) {
  if (!Capacitor.isNativePlatform()) return;
  const { notifications } = await LocalNotifications.getDeliveredNotifications().catch(() => ({ notifications: [] }));
  const shown = notifications.filter((notification) => notification.id === id);
  if (shown.length) await LocalNotifications.removeDeliveredNotifications({ notifications: shown }).catch(() => undefined);
}

/**
 * Calls back with the history entry id when a notification is tapped, and
 * which button was used ("tap" for the notification itself).
 */
export async function onNotificationTap(handler: (entryId: string, actionId: string, notificationId: number) => void) {
  const listener = await LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
    const entryId = action.notification.extra?.entryId;
    if (typeof entryId === "string") handler(entryId, action.actionId, action.notification.id);
  });
  return () => listener.remove();
}
