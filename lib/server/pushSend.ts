import { parseSubscriptionToken, reminderUrl } from "@/lib/webPush";
import { sendPush, type PushResult } from "./fcm";
import { pushChannel, type PushDevice } from "./reminderPush";
import { sendWebPush, type WebPushMessage } from "./webPush";

// One push to one device, by its channel: FCM for the Android app, Web Push
// for a browser (the site on an iPhone home screen). Same text, same page.

/** What a push opens: a scan (reminders) or a page of the app (plan reminders). */
export type PushTarget = { entryId: string } | { route: string };
export type DeviceMessage = { title: string; body: string; target: PushTarget };

/** The FCM message, read by services/push.ts (data.entryId or data.route). */
export function fcmMessage(message: DeviceMessage) {
  return { title: message.title, body: message.body, data: { ...message.target } as Record<string, string> };
}

/** The Web Push payload, read by public/sw.js: the page the app would open for the same FCM push. */
export function webMessage(message: DeviceMessage): WebPushMessage {
  const target = message.target;
  if ("entryId" in target) return { title: message.title, body: message.body, url: reminderUrl(target.entryId), tag: target.entryId };
  return { title: message.title, body: message.body, url: target.route };
}

export async function sendToDevice(device: PushDevice, message: DeviceMessage): Promise<PushResult> {
  if (pushChannel(device) === "fcm") return sendPush(device.token, fcmMessage(message));
  const subscription = parseSubscriptionToken(device.token);
  // A row that can't be read never will: forgotten like a 410.
  if (!subscription) return "invalid_token";
  return sendWebPush(subscription, webMessage(message));
}
