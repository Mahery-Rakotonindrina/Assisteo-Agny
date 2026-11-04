// Assisteo Agny's service worker, on the site only (never in the Android app:
// services/offline.ts does not register it there, and the app has FCM).
// - Web Push: reminders on an iPhone home screen and in browsers (the push
//   and notificationclick handlers below).
// - Offline: the pages already seen open again without internet; their data
//   is on the device already (IndexedDB).
//
// How it never serves a page of an old deployment with files that are gone:
// - pages are fetched from the network first: online, always the live version;
// - the cache belongs to one build (`?build=` in the worker's address, the
//   page's buildId); the next build's worker deletes it when it takes over;
// - a page is only kept if it comes from this build, and offline it is only
//   served if every script and stylesheet it names is in the cache too;
//   otherwise the small offline page (/offline.html) is shown instead.
// Nothing from /api/ nor from another site goes through it.

const BUILD = new URL(self.location.href).searchParams.get("build") || "none";
const PREFIX = "assisteo-offline-";
const CACHE = PREFIX + BUILD;
const OFFLINE_PAGE = "/offline.html";
// Every page's first script (pages/_document.tsx): kept at install, so a kept page starts offline.
const BOOT_SCRIPT = "/next-boot.js";

/** The fetches it answers: "page", "static" (fingerprinted, never changes), "asset" (icons…), else null. */
function strategyFor(request, origin) {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  if (url.origin !== origin) return null;
  if (url.pathname.startsWith("/api/") || url.pathname === "/sw.js") return null;
  if (request.mode === "navigate") return "page";
  if (url.pathname.startsWith("/_next/static/")) return "static";
  if (/^\/(icons|splash)\//.test(url.pathname) || /^\/(manifest\.webmanifest|favicon\.ico|icon\.svg|apple-touch-icon\.png|next-boot\.js)$/.test(url.pathname)) return "asset";
  return null;
}

/** The build a page comes from (Next writes it in the page's data), or null. */
function buildOf(html) {
  const match = /"buildId":"([^"]+)"/.exec(html);
  return match ? match[1] : null;
}

/** The scripts and stylesheets a page needs (its own files, fingerprinted). */
function assetsOf(html) {
  const found = new Set();
  const pattern = /(?:src|href)="(\/_next\/static\/[^"]+)"/g;
  let match;
  while ((match = pattern.exec(html))) found.add(match[1].replace(/&amp;/g, "&"));
  return [...found];
}

/** Where a page is kept: its path only (`?add=expense` opens the same page). */
function pageKey(url) {
  return new URL(url).pathname;
}

async function missingAssets(cache, html) {
  const missing = [];
  for (const asset of assetsOf(html)) {
    if (!(await cache.match(asset))) missing.push(asset);
  }
  return missing;
}

// The site's security headers (next.config.ts): a page served offline keeps them.
const SECURITY_HEADERS = [
  "Content-Security-Policy",
  "X-Content-Type-Options",
  "X-Frame-Options",
  "Referrer-Policy",
  "Permissions-Policy",
  "Cross-Origin-Opener-Policy",
  "Strict-Transport-Security",
];

/** What a kept page is served with: its type and the security headers it came with. */
function keptHeaders(from) {
  const headers = new Headers({ "Content-Type": "text/html; charset=utf-8" });
  for (const name of SECURITY_HEADERS) {
    const value = from ? from.get(name) : null;
    if (value) headers.set(name, value);
  }
  return headers;
}

/** Keeps a page of this build, after its files: a kept page always has them. */
async function keepPage(cache, path, html, headers) {
  if (BUILD !== "none" && buildOf(html) !== BUILD) return false;
  for (const asset of await missingAssets(cache, html)) {
    const response = await fetch(asset);
    if (!response.ok) return false;
    await cache.put(asset, response);
  }
  await cache.put(path, new Response(html, { headers: keptHeaders(headers) }));
  return true;
}

/** Offline: the kept page if all its files are there, else the offline page. */
async function offlinePage(cache, path) {
  const kept = await cache.match(path);
  if (kept) {
    const html = await kept.clone().text();
    if ((await missingAssets(cache, html)).length === 0) return kept;
  }
  return (await cache.match(OFFLINE_PAGE)) || Response.error();
}

async function handlePage(event) {
  const cache = await caches.open(CACHE);
  const path = pageKey(event.request.url);
  let response;
  try {
    response = await fetch(event.request);
  } catch {
    return offlinePage(cache, path);
  }
  const type = response.headers.get("Content-Type") || "";
  if (response.ok && !response.redirected && type.includes("text/html")) {
    const copy = response.clone();
    event.waitUntil(copy.text().then((html) => keepPage(cache, path, html, response.headers)).catch(() => false));
  }
  return response;
}

async function handleStatic(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function handleAsset(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("install", (event) => {
  // The new version takes over at once; the open pages are not reloaded.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([OFFLINE_PAGE, BOOT_SCRIPT]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith(PREFIX) && name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const strategy = strategyFor(event.request, self.location.origin);
  if (strategy === "page") event.respondWith(handlePage(event));
  else if (strategy === "static") event.respondWith(handleStatic(event.request));
  else if (strategy === "asset") event.respondWith(handleAsset(event.request));
});

// A page opened without a full load (a tap in the app): kept with its files too.
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "keep" || typeof data.url !== "string") return;
  const url = new URL(data.url, self.location.origin);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      const path = url.pathname;
      const kept = await cache.match(path);
      if (kept) return keepPage(cache, path, await kept.text(), kept.headers);
      const response = await fetch(path, { credentials: "same-origin" });
      if (!response.ok || !(response.headers.get("Content-Type") || "").includes("text/html")) return false;
      return keepPage(cache, path, await response.text(), response.headers);
    }).catch(() => false),
  );
});

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

// Unit tests (tests/unit/serviceWorker.test.ts) load this file in Node.
if (typeof module === "object" && module.exports) {
  module.exports = { strategyFor, buildOf, assetsOf, pageKey, keepPage, keptHeaders, offlinePage, CACHE, OFFLINE_PAGE, BOOT_SCRIPT };
}
