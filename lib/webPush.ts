// Standard Web Push (VAPID) for the site, above all on an iPhone where it is
// added to the home screen (iOS 16.4 and later): pure helpers shared by the
// settings button, the subscription API and the reminders cron.

/** What the "receive reminders on this iPhone" row shows. */
export type WebPushState = "hidden" | "install" | "signin" | "locked" | "ready";

export type WebPushContext = {
  /** The server's VAPID public key; null when the keys aren't set (or in demo). */
  publicKey: string | null;
  /** The Android app (Capacitor): it has its own pushes (FCM). */
  native: boolean;
  /** iPhone or iPad. */
  ios: boolean;
  /** Launched from the home screen (display-mode: standalone). */
  standalone: boolean;
  /** Service worker, PushManager and Notification all there. */
  supported: boolean;
  signedIn: boolean;
  /** The plan has reminders. */
  canRemind: boolean;
};

export function webPushState(context: WebPushContext): WebPushState {
  if (!context.publicKey || context.native) return "hidden";
  // Safari only offers push to a site opened from its home-screen icon.
  if (context.ios && !context.standalone) return "install";
  if (!context.supported) return "hidden";
  if (!context.signedIn) return "signin";
  return context.canRemind ? "ready" : "locked";
}

/** iPhone, iPod or iPad (iPadOS says "Macintosh", but has a touch screen). */
export function isIosDevice(userAgent: string, maxTouchPoints = 0) {
  return /iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
}

/**
 * The page a reminder push opens, the same as a tapped FCM push (data.entryId,
 * see services/notificationTap.ts): the scan, offering "remind me later".
 */
export function reminderUrl(entryId: string) {
  return `/result?id=${encodeURIComponent(entryId)}&reminded=1`;
}

/** The push services of Apple, Google, Mozilla and Microsoft: the server never posts anywhere else. */
const PUSH_HOSTS = [/^web\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/];

export function isPushEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && !url.port && PUSH_HOSTS.some((host) => host.test(url.hostname));
  } catch {
    return false;
  }
}

export type WebPushSubscription = { endpoint: string; keys: { p256dh: string; auth: string } };

/** Kept in push_devices.token (platform "web"), always written the same way so it can be compared. */
export function subscriptionToken(subscription: WebPushSubscription) {
  return JSON.stringify({ endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } });
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** Back from push_devices.token; null when it isn't a usable subscription. */
export function parseSubscriptionToken(token: string): WebPushSubscription | null {
  try {
    const value = JSON.parse(token) as Partial<WebPushSubscription> | null;
    const endpoint = value?.endpoint;
    const p256dh = value?.keys?.p256dh;
    const auth = value?.keys?.auth;
    if (typeof endpoint !== "string" || !isPushEndpoint(endpoint)) return null;
    if (typeof p256dh !== "string" || !BASE64URL.test(p256dh) || typeof auth !== "string" || !BASE64URL.test(auth)) return null;
    return { endpoint, keys: { p256dh, auth } };
  } catch {
    return null;
  }
}

/** The VAPID public key as PushManager.subscribe wants it. */
export function base64UrlToBytes(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
