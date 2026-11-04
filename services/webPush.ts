import { Capacitor } from "@capacitor/core";
import { base64UrlToBytes, isIosDevice } from "@/lib/webPush";
import { authHeaders } from "./account";
import { httpClient } from "./httpClient";
import { serviceWorkerUrl } from "./offline";
import { getInstallId } from "./trial";
import { setPushTakeover } from "./webPushTakeover";

// Reminders by Web Push on the site (an iPhone home screen, browsers): the
// service worker (public/sw.js, also registered for offline use by
// services/offline.ts) is subscribed when the user taps the button in the
// settings, never in the Android app (it has FCM, services/push.ts).

export type WebPushStatus = {
  /** The server's VAPID public key; null when Web Push is off (no keys, accounts or demo). */
  publicKey: string | null;
  /** The server holds this browser's subscription for the signed-in account. */
  registered: boolean;
};

// The server's answer for this device, kept for the session (set again by the button).
let confirmed: { deviceId: string; registered: boolean } | null = null;

/** The key and, signed in, whether the server has this browser's row. Throws when it can't be read. */
export async function fetchWebPushStatus(): Promise<WebPushStatus> {
  if (Capacitor.isNativePlatform()) return { publicKey: null, registered: false };
  const [deviceId, headers] = await Promise.all([getInstallId(), authHeaders()]);
  const signedIn = Boolean(headers.Authorization);
  const status = await httpClient.get<WebPushStatus>(`/api/push/web${signedIn ? `?deviceId=${encodeURIComponent(deviceId)}` : ""}`, { headers });
  const registered = signedIn && status.registered === true;
  confirmed = { deviceId, registered };
  return { publicKey: status.publicKey ?? null, registered };
}

/** The session's answer, else the server's (one read). */
async function serverHasRow() {
  const deviceId = await getInstallId();
  if (confirmed?.deviceId === deviceId) return confirmed.registered;
  const status = await fetchWebPushStatus();
  return status.publicKey !== null && status.registered;
}

export function webPushSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** Launched from the home-screen icon. */
export function isStandalone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches === true || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function isIos() {
  return typeof navigator !== "undefined" && isIosDevice(navigator.userAgent, navigator.maxTouchPoints);
}

async function existingSubscription() {
  if (!webPushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}


/** This browser receives the reminders: subscribed here, allowed, and known to the server. */
export function isReceiving(browserSubscribed: boolean, permission: string, registered: boolean) {
  return browserSubscribed && permission === "granted" && registered;
}

/** Whether this browser already receives the reminders (the button shows "Stop"). */
export async function webPushSubscribed(registered: boolean) {
  if (!webPushSupported()) return false;
  return isReceiving((await existingSubscription().catch(() => null)) !== null, Notification.permission, registered);
}

export type SubscribeOutcome = "subscribed" | "denied" | "error";

/** Asks for the permission (Safari: only from a tap), then subscribes this browser for the account. */
export async function subscribeWebPush(publicKey: string): Promise<SubscribeOutcome> {
  // First, still inside the tap: Safari refuses the prompt otherwise.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";
  let subscription: PushSubscription | null = null;
  try {
    // Already there on the site (services/offline.ts, at load): registering again from a tab
    // opened before a deployment would put that old build's worker back and lose the offline pages.
    if (!(await navigator.serviceWorker.getRegistration("/"))) await navigator.serviceWorker.register(serviceWorkerUrl(), { scope: "/" });
    const registration = await navigator.serviceWorker.ready;
    subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) }));
    const deviceId = await getInstallId();
    await httpClient.post<void>("/api/push/web", { deviceId, subscription: subscription.toJSON() }, { headers: await authHeaders() });
    confirmed = { deviceId, registered: true };
    setPushTakeover(true);
    return "subscribed";
  } catch {
    // Not saved by the server (offline, migration missing…): no subscription left behind
    // here, so the page keeps its own reminders.
    await subscription?.unsubscribe().catch(() => undefined);
    confirmed = null;
    setPushTakeover(false);
    return "error";
  }
}

/** This browser stops receiving the reminders (the button, or signing out). */
export async function unsubscribeWebPush() {
  setPushTakeover(false);
  confirmed = null;
  const subscription = await existingSubscription().catch(() => null);
  if (!subscription) return;
  await subscription.unsubscribe().catch(() => undefined);
  // Signed out already: the server forgets it at the first push (410).
  const headers = await authHeaders();
  if (headers.Authorization) await httpClient.delete<void>("/api/push/web", { body: { deviceId: await getInstallId() }, headers }).catch(() => undefined);
}

/**
 * At start: Web Push takes over the in-page reminders only while this browser
 * is subscribed and the server confirms its row. Any doubt (offline, error,
 * no row): the page keeps its own reminders.
 */
export async function refreshPushTakeover() {
  if (Capacitor.isNativePlatform() || !webPushSupported()) return;
  const subscribed = (await existingSubscription().catch(() => null)) !== null && Notification.permission === "granted";
  if (!subscribed) {
    setPushTakeover(false);
    return;
  }
  setPushTakeover(await serverHasRow().catch(() => false));
}

/** For the tests. */
export function resetWebPushStatus() {
  confirmed = null;
}
