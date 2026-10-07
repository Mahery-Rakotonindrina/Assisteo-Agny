import { useEffect, useRef } from "react";
import { useReminderTexts } from "@/hooks/useReminderTexts";
import { historyStore } from "@/services/historyStore";
import { reconcileReminders } from "@/services/reminders";

/**
 * Keeps this device's notifications in line with the history: insurance
 * notices, reminders set on other devices, reminders removed elsewhere.
 */
export function ReminderKeeper() {
  const texts = useReminderTexts();
  const textsRef = useRef(texts);

  useEffect(() => {
    textsRef.current = texts;
  }, [texts]);

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
