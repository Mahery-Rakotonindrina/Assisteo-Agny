import { useEffect, useRef } from "react";
import { useReminderTexts } from "@/hooks/useReminderTexts";
import { useTranslation } from "@/hooks/useTranslation";
import { historyStore } from "@/services/historyStore";
import { reconcileReminders, registerReminderActions } from "@/services/reminders";

/**
 * Keeps this device's notifications in line with the history: insurance
 * notices, reminders set on other devices, reminders removed elsewhere,
 * recurring reminders moved on. Also registers the "in 1 h" / "tomorrow"
 * buttons of the notifications (Android app; taps: useNativeBootstrap).
 */
export function ReminderKeeper() {
  const texts = useReminderTexts();
  const textsRef = useRef(texts);
  const { t } = useTranslation();

  useEffect(() => {
    textsRef.current = texts;
  }, [texts]);

  // The buttons follow the language.
  useEffect(() => {
    void registerReminderActions({ hour: t("reminders.notifyHour"), tomorrow: t("reminders.notifyTomorrow") });
  }, [t]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void reconcileReminders(textsRef.current), 1200);
    };
    run();
    const unsubscribe = historyStore.subscribe(run);
    const onVisible = () => document.visibilityState === "visible" && run();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
