import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { supabase } from "@/lib/supabase";
import { historyStore } from "./historyStore";
import { notify } from "./notifications";
import { getInstallId } from "./trial";

// Server push for reminders (Android only for now). Local notifications stay
// the primary path: precise and offline. Push covers this device when a
// reminder was set elsewhere and the app hasn't been opened here since. The
// device tells the server which reminders it already holds locally, so the
// server only pushes the others (no duplicates).

/**
 * Push needs Firebase in the APK (google-services.json, see docs/push.md);
 * without it, registering would crash the app. The CI sets this flag only
 * when the file is present.
 */
export const pushAvailable = () => process.env.NEXT_PUBLIC_PUSH_ENABLED === "true" && Capacitor.getPlatform() === "android";

let listenersReady = false;
// Last list sent to the server, to skip identical updates.
let lastReported: string | null = null;

async function saveToken(token: string) {
  lastReported = null;
  const deviceId = await getInstallId();
  await supabase()
    .from("push_devices")
    .upsert({ device_id: deviceId, token, platform: "android", updated_at: new Date().toISOString() }, { onConflict: "user_id,device_id" });
  await reportScheduledReminders();
}

/** Registers this device for reminder pushes. Never prompts: notifications must already be allowed. */
export async function registerPush(onOpen: (entryId: string) => void) {
  if (!pushAvailable()) return;
  const { receive } = await PushNotifications.checkPermissions();
  if (receive !== "granted") return;

  if (!listenersReady) {
    listenersReady = true;
    await PushNotifications.addListener("registration", ({ value }) => void saveToken(value).catch(() => undefined));
    // Android only shows pushes by itself when the app is in the background.
    await PushNotifications.addListener("pushNotificationReceived", (notification) => {
      const entryId = typeof notification.data?.entryId === "string" ? notification.data.entryId : undefined;
      void notify({ title: notification.title ?? "", body: notification.body ?? "", entryId }).catch(() => undefined);
    });
    await PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => {
      const entryId = notification.data?.entryId;
      if (typeof entryId === "string") onOpen(entryId);
    });
    // Same look as local reminders.
    await PushNotifications.createChannel({ id: "reminders", name: "Rappels", importance: 4, visibility: 1 }).catch(() => undefined);
  }
  await PushNotifications.register();
}

/** Signing out or deleting the account: this device stops receiving the account's pushes. */
export async function unregisterPush() {
  if (!pushAvailable()) return;
  const deviceId = await getInstallId();
  await supabase().from("push_devices").delete().eq("device_id", deviceId);
  await PushNotifications.unregister().catch(() => undefined);
}

/** Tells the server which reminders this device will show by itself. */
export async function reportScheduledReminders() {
  if (!pushAvailable()) return;
  const { data } = await supabase().auth.getSession();
  if (!data.session) return;
  const now = Date.now();
  const scheduled = (await historyStore.list())
    // Only reminders this device will show at the right time.
    .filter((entry) => entry.reminderId && entry.reminderAt && entry.reminderAt > now && entry.reminderScheduledAt === entry.reminderAt)
    .map((entry) => entry.id)
    .sort();
  const key = scheduled.join(",");
  if (key === lastReported) return;
  const deviceId = await getInstallId();
  const { error } = await supabase().from("push_devices").update({ scheduled, updated_at: new Date().toISOString() }).eq("device_id", deviceId);
  if (!error) lastReported = key;
}
