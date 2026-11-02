// While this browser receives reminders by Web Push (services/webPush.ts), the
// scan reminders are not also scheduled in the page: the push shows them,
// once. Unsubscribing (or the server's keys gone) brings the local ones back.
// The Android app is never concerned: it keeps its local notifications.

const KEY = "assisteo.webPushReminders";
const listeners = new Set<() => void>();

/** Whether this notification is left to Web Push: a scan reminder for later, on the web, with push on here. */
export function pushTakesOver({ native, takeover, scanReminder, later }: { native: boolean; takeover: boolean; scanReminder: boolean; later: boolean }) {
  return !native && takeover && scanReminder && later;
}

export function readPushTakeover() {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Notes whether Web Push takes over here; the listeners hear of a change only. */
export function setPushTakeover(on: boolean) {
  if (readPushTakeover() === on) return;
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    return;
  }
  listeners.forEach((listener) => listener());
}

export function onPushTakeoverChange(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
