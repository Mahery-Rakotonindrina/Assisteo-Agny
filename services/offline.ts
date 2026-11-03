import { Capacitor } from "@capacitor/core";
import Router from "next/router";

// The site opens without internet on the pages already seen: public/sw.js
// keeps them with their files. Registered for every visitor of the site, but
// never in the Android app (its pages are in the APK) nor in development
// (the dev server's files change all the time).

/** The worker's address: its cache belongs to this build (see public/sw.js). */
export function serviceWorkerUrl() {
  const build = typeof window === "undefined" ? undefined : (window as Window & { __NEXT_DATA__?: { buildId?: string } }).__NEXT_DATA__?.buildId;
  return build ? `/sw.js?build=${encodeURIComponent(build)}` : "/sw.js";
}

export function offlineSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && !Capacitor.isNativePlatform() && process.env.NODE_ENV === "production";
}

/** Asks the worker to keep a page opened without a full load (a tap in the app). */
function keep(url: string) {
  void navigator.serviceWorker.ready.then((registration) => registration.active?.postMessage({ type: "keep", url })).catch(() => undefined);
}

let started = false;

/**
 * Registers the worker once. A new version takes over by itself (it does not
 * wait, and nothing reloads the page): no update loop.
 */
export async function startOffline() {
  if (started || !offlineSupported()) return;
  started = true;
  try {
    await navigator.serviceWorker.register(serviceWorkerUrl(), { scope: "/" });
  } catch {
    // Blocked (private mode, a browser setting): the site works as before.
    return;
  }
  // The first page was loaded before the worker: kept now, then each page opened.
  keep(location.pathname);
  Router.events.on("routeChangeComplete", (url: string) => keep(url));
}
