import { useCallback, useEffect, useRef } from "react";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { useSettings } from "@/lib/settings/SettingsProvider";
import { reconcilePlantReminders, type PlantReminderTexts } from "@/services/plantReminders";
import { plantStore } from "@/services/plantStore";

/**
 * Keeps the "Mes plantes" morning notifications in line with the plants and
 * the plan, at launch and whenever either changes. Without "plants" or the
 * reminders they are cancelled, and come back with them.
 */
export function PlantReminderKeeper() {
  const { t } = useTranslation();
  const { ready } = useSettings();
  const { plan, has } = usePlan();
  // Unknown until the plan is read once (cache or server): nothing is cancelled meanwhile.
  const known = plan !== null;
  const enabled = has("plants") && has("reminders");
  const texts = useCallback<PlantReminderTexts>(
    (names) => ({
      title: t("plants.reminder.title"),
      body: names.length === 1 ? t("plants.reminder.one", { name: names[0] }) : t("plants.reminder.many", { count: names.length, names: names.slice(0, 4).join(", ") }),
    }),
    [t],
  );
  const latest = useRef<PlantReminderTexts>(texts);

  useEffect(() => {
    latest.current = texts;
  }, [texts]);

  useEffect(() => {
    if (!ready || !known) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void reconcilePlantReminders((names) => latest.current(names), enabled), 1200);
    };
    run();
    const unsubscribe = plantStore.subscribe(run);
    const onVisible = () => document.visibilityState === "visible" && run();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
    // A language change re-runs it, so the texts follow.
  }, [ready, known, enabled, texts]);

  return null;
}
