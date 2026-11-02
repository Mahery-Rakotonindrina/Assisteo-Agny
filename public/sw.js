// Assisteo Agny: Web Push only (reminders on an iPhone home screen, and
// browsers). Registered when the user taps "receive reminders" in the
// settings (services/webPush.ts), never in the Android app nor in demo.
// No cache and no fetch handler: it changes nothing to how the site loads.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/** Only the site's own pages. */
function safePath(url) {
  return typeof url === "string" && url.startsWith("/") && !url.startsWith("//") ? url : "/";
}

// The payload is written by lib/server/pushSend.ts (webMessage): title, body, url, tag.
self.addEventListener("push", (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = { body: event.data ? event.data.text() : "" };
  }
  const options = {
    body: message.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: safePath(message.url) },
  };
  if (message.tag) options.tag = String(message.tag);
  // iOS drops the subscription of a push that shows nothing: always show one.
  event.waitUntil(self.registration.showNotification(message.title || "Assisteo Agny", options));
});

// Opens the reminder's page, in the open window if there is one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(safePath(event.notification.data && event.notification.data.url), self.location.origin);
  // A path read as another site (a backslash after the slash): the home page instead.
  const url = target.origin === self.location.origin ? target.href : new URL("/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          // navigate() fails on a window this worker doesn't control yet: a new one then.
          return client
            .focus()
            .then((focused) => focused.navigate(url))
            .catch(() => self.clients.openWindow(url));
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
