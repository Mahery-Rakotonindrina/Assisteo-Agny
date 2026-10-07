import { useRouter } from "next/router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ScanMode } from "@/lib/ai/schema";
import { prepareCapture } from "@/lib/image";
import { useSettings } from "@/lib/settings/SettingsProvider";
import { analysisService } from "@/services/analysisService";
import { CaptureCancelledError, capturePhoto, type PhotoSource } from "@/services/camera";
import { haptics } from "@/services/device";
import { createId, historyStore } from "@/services/historyStore";
import { notify } from "@/services/notifications";
import { ensureCameraAccess } from "@/services/permissions";
import { updateEarlierParcelScans } from "@/services/parcelLinking";
import { compactOldPhotos } from "@/services/photoStorage";
import { trialStore } from "@/services/trial";
import { insuranceReminderAt, scheduleReminder } from "@/services/reminders";
import { useReminderTexts } from "./useReminderTexts";
import { ApiError } from "@/types/api";
import { useTranslation } from "./useTranslation";

export type ScanErrorKind =
  | "network"
  | "rate_limited"
  | "refused"
  | "unavailable"
  | "billing"
  | "invalid_key"
  | "trial_exhausted"
  | "server_busy"
  | "invalid_request"
  | "upstream_error"
  | "image"
  | "camera"
  | "notImage"
  | "unknown";

export type ScanState =
  | { phase: "idle" }
  | { phase: "preparing"; previewSrc: string }
  | { phase: "analyzing"; previewSrc: string; startedAt: number }
  | { phase: "error"; previewSrc?: string; error: ScanErrorKind };

type Prepared = Awaited<ReturnType<typeof prepareCapture>>;

function toErrorKind(error: unknown): ScanErrorKind {
  if (error instanceof ApiError) {
    const code = error.code;
    return code === "method_not_allowed" || code === "ask_limit" ? "unknown" : code;
  }
  return "unknown";
}

/**
 * The capture → prepare → analyse → save pipeline behind the scan screen.
 */
export function useScan(mode: ScanMode) {
  const router = useRouter();
  const { settings } = useSettings();
  const { t, locale } = useTranslation();
  const reminderTexts = useReminderTexts();
  const [state, setState] = useState<ScanState>({ phase: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const lastCaptureRef = useRef<Prepared | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const analyze = useCallback(
    async (prepared: Prepared) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setState({ phase: "analyzing", previewSrc: prepared.preview.dataUrl, startedAt: Date.now() });

      try {
        const { analysis, meta } = await analysisService.analyze(
          { image: prepared.upload.base64, mediaType: prepared.upload.mediaType, mode, locale },
          controller.signal,
        );

        if (meta.trial) trialStore.update(meta.trial);

        const id = createId();
        await historyStore.save({
          id,
          createdAt: Date.now(),
          mode,
          thumbnail: prepared.thumbnail.dataUrl,
          preview: prepared.preview.dataUrl,
          analysis,
          meta,
        });

        // Insurance: the 5-day notice is scheduled right away, without asking.
        const forcedAt = insuranceReminderAt(analysis);
        if (forcedAt !== null) {
          const saved = await historyStore.get(id);
          if (saved) await scheduleReminder(saved, forcedAt, reminderTexts.insurance(saved));
        }

        // A parcel scanned before: the earlier scans take the new status.
        if (analysis.parcel) {
          const saved = await historyStore.get(id);
          if (saved) await updateEarlierParcelScans(saved).catch(() => undefined);
        }

        haptics.success();
        if (settings.notifyOnResult && document.visibilityState === "hidden") {
          void notify({ title: t("notifications.readyTitle"), body: analysis.title, entryId: id });
        }
        lastCaptureRef.current = null;
        void compactOldPhotos().catch(() => undefined);
        await router.push({ pathname: "/result", query: { id } });
        setState({ phase: "idle" });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.code === "trial_exhausted") trialStore.markExhausted();
        haptics.error();
        setState({ phase: "error", previewSrc: prepared.preview.dataUrl, error: toErrorKind(error) });
      }
    },
    [locale, mode, reminderTexts, router, settings.notifyOnResult, t],
  );

  const prepareAndAnalyze = useCallback(
    async (src: string) => {
      setState({ phase: "preparing", previewSrc: src });
      let prepared: Prepared;
      try {
        prepared = await prepareCapture(src);
      } catch {
        setState({ phase: "error", error: "image" });
        return;
      } finally {
        if (src.startsWith("blob:")) URL.revokeObjectURL(src);
      }

      lastCaptureRef.current = prepared;
      await analyze(prepared);
    },
    [analyze],
  );

  /** Camera or photo library (native, or their web fallbacks). */
  const start = useCallback(
    async (source: PhotoSource) => {
      haptics.press();
      if (!(await ensureCameraAccess())) {
        haptics.error();
        setState({ phase: "error", error: "camera" });
        return;
      }
      let src: string;
      try {
        src = await capturePhoto(source);
      } catch (error) {
        if (error instanceof CaptureCancelledError) return;
        setState({ phase: "error", error: "camera" });
        return;
      }
      await prepareAndAnalyze(src);
    },
    [prepareAndAnalyze],
  );

  /** A file dropped, pasted or picked in the browser. */
  const startWithFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        setState({ phase: "error", error: "notImage" });
        return;
      }
      await prepareAndAnalyze(URL.createObjectURL(file));
    },
    [prepareAndAnalyze],
  );

  const retry = useCallback(() => {
    if (lastCaptureRef.current) void analyze(lastCaptureRef.current);
  }, [analyze]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    lastCaptureRef.current = null;
    setState({ phase: "idle" });
  }, []);

  return { state, start, startWithFile, retry, reset, canRetry: state.phase === "error" && Boolean(state.previewSrc) };
}
