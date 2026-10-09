import { App } from "@capacitor/app";
import { useCallback, useEffect, useRef } from "react";
import { useToast } from "@/components/Toast";
import { useReminderTexts } from "@/hooks/useReminderTexts";
import { toErrorKind } from "@/hooks/useScan";
import { useTranslation } from "@/hooks/useTranslation";
import { useSettings } from "@/lib/settings/SettingsProvider";
import { haptics, isNative } from "@/services/device";
import { notify } from "@/services/notifications";
import { planStore } from "@/services/plan";
import { isOffline, saveScan, sendScan } from "@/services/scanPipeline";
import { scanQueue } from "@/services/scanQueue";
import { ApiError } from "@/types/api";

const RETRY_MS = 30_000;

/**
 * Sends the scans waiting in the offline queue, one after the other: when the
 * network comes back, when the app comes back to the foreground, and every
 * 30 seconds while some wait. Renders nothing.
 */
export function ScanQueueRunner() {
  const { t } = useTranslation();
  const toast = useToast();
  const { settings } = useSettings();
  const reminderTexts = useReminderTexts();
  const running = useRef(false);

  const run = useCallback(async () => {
    if (running.current || (typeof navigator !== "undefined" && navigator.onLine === false)) return;
    running.current = true;
    try {
      for (const item of await scanQueue.list()) {
        if (item.status !== "waiting") continue;
        await scanQueue.update(item.id, { status: "sending" });
        try {
          const response = await sendScan(item);
          const id = await saveScan(item, response, reminderTexts.insurance, item.createdAt);
          await scanQueue.remove(item.id);
          haptics.success();
          if (document.visibilityState === "visible") toast(t("queue.done", { title: response.analysis.title }));
          else if (settings.notifyOnResult) void notify({ title: t("notifications.readyTitle"), body: response.analysis.title, entryId: id });
        } catch (error) {
          if (isOffline(error)) {
            await scanQueue.update(item.id, { status: "waiting" });
            break;
          }
          if (error instanceof ApiError && (error.code === "trial_exhausted" || error.code === "plan_limit")) planStore.markScansUsedUp();
          await scanQueue.update(item.id, { status: "failed", error: toErrorKind(error) });
        }
      }
    } finally {
      running.current = false;
    }
  }, [reminderTexts, settings.notifyOnResult, t, toast]);

  useEffect(() => {
    // A send cut short (app closed mid-way) goes again.
    void (async () => {
      for (const item of await scanQueue.list()) if (item.status === "sending") await scanQueue.update(item.id, { status: "waiting" });
      await run();
    })();

    const again = () => void run();
    const onVisible = () => {
      if (document.visibilityState === "visible") again();
    };
    window.addEventListener("online", again);
    document.addEventListener("visibilitychange", onVisible);
    const resume = isNative() ? App.addListener("resume", again) : null;
    const timer = setInterval(again, RETRY_MS);
    const unsubscribe = scanQueue.onWake(again);
    return () => {
      window.removeEventListener("online", again);
      document.removeEventListener("visibilitychange", onVisible);
      void resume?.then((handle) => handle.remove());
      clearInterval(timer);
      unsubscribe();
    };
  }, [run]);

  return null;
}
