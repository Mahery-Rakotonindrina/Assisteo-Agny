import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
import { useRouter } from "next/router";
import { useEffect, useRef } from "react";
import { useToast } from "@/components/Toast";
import { formatDateTime } from "@/lib/format";
import { useSettings } from "@/lib/settings/SettingsProvider";
import { handleNotificationTap } from "@/services/notificationTap";
import { onNotificationTap } from "@/services/notifications";
import { snoozeFromNotification } from "@/services/reminders";
import { compactOldPhotos } from "@/services/photoStorage";
import { useReminderTexts } from "./useReminderTexts";
import { useTranslation } from "./useTranslation";

/** One-time platform wiring: splash, status bar, Android back button, notification taps. */
export function useNativeBootstrap() {
  const router = useRouter();
  const routerRef = useRef(router);
  const { settings, ready } = useSettings();
  const { t, locale } = useTranslation();
  const toast = useToast();
  const texts = useReminderTexts();
  const tapRef = useRef({ t, locale, toast, texts });

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    tapRef.current = { t, locale, toast, texts };
  }, [t, locale, toast, texts]);

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

    // The only tap listener: on a cold start Capacitor hands the tap to the first one alone.
    void onNotificationTap((entryId, actionId, notificationId) => {
      void handleNotificationTap(entryId, actionId, notificationId, {
        snooze: (id, action, notification) => snoozeFromNotification(id, action, notification, tapRef.current.texts.other),
        open: (target) => void routerRef.current.push(target),
        snoozed: (at) => {
          const { t, locale, toast } = tapRef.current;
          toast(t("result.reminderSet", { date: formatDateTime(at, locale) }));
        },
      });
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
