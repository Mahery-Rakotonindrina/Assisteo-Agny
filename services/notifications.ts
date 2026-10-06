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

type NotifyOptions = {
  title: string;
  body: string;
  /** Deliver later instead of now. */
  at?: Date;
  /** History entry to open when the notification is tapped. */
  entryId?: string;
};

export async function notify({ title, body, at, entryId }: NotifyOptions): Promise<number | null> {
  if ((await getNotificationPermission()) !== "granted") return null;

  const id = nextId();
  await LocalNotifications.schedule({
    notifications: [
      {
        id,
        title,
        body,
        extra: entryId ? { entryId } : undefined,
        ...(at && { schedule: { at, allowWhileIdle: true } }),
      },
    ],
  });
  return id;
}

export async function cancelNotification(id: number) {
  await LocalNotifications.cancel({ notifications: [{ id }] }).catch(() => undefined);
}

/** Calls back with the history entry id when a notification is tapped. */
export async function onNotificationTap(handler: (entryId: string) => void) {
  const listener = await LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
    const entryId = action.notification.extra?.entryId;
    if (typeof entryId === "string") handler(entryId);
  });
  return () => listener.remove();
}
