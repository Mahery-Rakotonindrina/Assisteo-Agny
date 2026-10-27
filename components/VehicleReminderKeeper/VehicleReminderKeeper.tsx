import { useEffect, useRef } from "react";
import { usePlan } from "@/hooks/usePlan";
import { useVehicleReminderTexts } from "@/hooks/useVehicleReminderTexts";
import { useSettings } from "@/lib/settings/SettingsProvider";
import { reconcileVehicleReminders, type VehicleReminderTexts } from "@/services/vehicleReminders";
import { vehicleStore } from "@/services/vehicleStore";

/**
 * Keeps the "Mon garage" notifications (insurance, inspection, oil change,
 * odometer) in line with the vehicles and the plan, at launch and whenever
 * either changes. Below Premium they are cancelled, and come back with it.
 */
export function VehicleReminderKeeper() {
  const texts = useVehicleReminderTexts();
  const { ready } = useSettings();
  const { plan, has } = usePlan();
  // Unknown until the plan is read once (cache or server): nothing is cancelled meanwhile.
  const known = plan !== null;
  // The garage (Premium) includes the reminders (Lite and up).
  const enabled = has("garage") && has("reminders");
  const latest = useRef<VehicleReminderTexts>(texts);

  useEffect(() => {
    latest.current = texts;
  }, [texts]);

  useEffect(() => {
    if (!ready || !known) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void reconcileVehicleReminders((vehicle, reminder) => latest.current(vehicle, reminder), enabled), 1200);
    };
    run();
    const unsubscribe = vehicleStore.subscribe(run);
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
