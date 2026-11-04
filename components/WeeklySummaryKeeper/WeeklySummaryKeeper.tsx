import { useEffect, useSyncExternalStore } from "react";
import { useNow } from "@/hooks/useNow";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { useWeekLines, useWeekSummary } from "@/hooks/useWeekSummary";
import { nextSummaryAt, summaryIsEmpty } from "@/lib/weeklySummary";
import { useSettings } from "@/lib/settings/SettingsProvider";
import { isNative } from "@/services/device";
import { reconcileWeekly } from "@/services/weeklySummary";

const noSubscribe = () => () => {};

/**
 * Keeps the Sunday "Ta semaine" notification in line with the setting, the
 * plan (reminders: Lite and up) and the data of the device. The Android app
 * only: the site shows the card on the home screen instead (WeekCard).
 */
export function WeeklySummaryKeeper() {
  const { settings, ready } = useSettings();
  const { plan, has } = usePlan();
  // Known once mounted: the server and the hydration render nothing.
  const native = useSyncExternalStore(noSubscribe, isNative, () => false);
  // Unknown until the plan is read once (cache or server): nothing is cancelled meanwhile.
  if (!native || !ready || plan === null) return null;
  return <Scheduler enabled={settings.weeklySummary && has("reminders")} />;
}

function Scheduler({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation();
  const now = useNow(60 * 60_000);
  const at = nextSummaryAt(now);
  const summary = useWeekSummary(at);
  const lines = useWeekLines(summary);
  const body = lines.join(" ");
  const title = t("weekly.notifTitle");
  const empty = summaryIsEmpty(summary);

  useEffect(() => {
    const timer = setTimeout(() => void reconcileWeekly(enabled && !empty ? { at, title, body } : null), 2000);
    return () => clearTimeout(timer);
  }, [enabled, empty, at, title, body]);

  return null;
}
