import { Capacitor } from "@capacitor/core";
import { useSyncExternalStore } from "react";

// Keep in sync with $desktop-min in styles/_mixins.scss.
const QUERY = "(min-width: 1024px)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getSnapshot() {
  return !Capacitor.isNativePlatform() && window.matchMedia(QUERY).matches;
}

/** True in a desktop-sized browser; always false in the native apps and during SSR. */
export function useIsDesktop() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
