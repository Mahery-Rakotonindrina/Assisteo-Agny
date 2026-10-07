import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
import { useRouter } from "next/router";
import { useEffect, useRef } from "react";
import { useSettings } from "@/lib/settings/SettingsProvider";
import { onNotificationTap } from "@/services/notifications";
import { compactOldPhotos } from "@/services/photoStorage";

/** One-time platform wiring: splash, status bar, Android back button, notification taps. */
export function useNativeBootstrap() {
  const router = useRouter();
  const routerRef = useRef(router);
  const { settings, ready } = useSettings();

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    const cleanups: Array<() => void> = [];

    if (Capacitor.isNativePlatform()) {
      document.documentElement.classList.add("native");
      void StatusBar.setOverlaysWebView({ overlay: true }).catch(() => undefined);
      void App.addListener("backButton", ({ canGoBack }) => {
        if (routerRef.current.pathname === "/" || !canGoBack) void App.exitApp();
        else routerRef.current.back();
      }).then((handle) => cleanups.push(() => void handle.remove()));
    } else {
      // Web fallback UI for Camera.takePhoto (in-page camera modal).
      void import("@ionic/pwa-elements/loader").then(({ defineCustomElements }) => defineCustomElements(window));
    }

    // Shrink the photos of old scans once per launch (see photoStorage).
    void compactOldPhotos().catch(() => undefined);

    void onNotificationTap((entryId) => {
      void routerRef.current.push({ pathname: "/result", query: { id: entryId } });
    }).then((cleanup) => cleanups.push(cleanup));

    return () => cleanups.forEach((cleanup) => cleanup());
  }, []);

  // Hide the splash once settings (theme, locale) are applied, to avoid a flash.
  useEffect(() => {
    if (ready && Capacitor.isNativePlatform()) void SplashScreen.hide().catch(() => undefined);
  }, [ready]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const dark = settings.theme === "dark" || (settings.theme === "system" && prefersDark);
    void StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => undefined);
  }, [settings.theme]);
}
