import { useRouter } from "next/router";
import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_PAGES, type ScanMode } from "@/lib/ai/schema";
import type { ScannedCode } from "@/lib/codes";
import { prepareCapture, type PreparedCapture } from "@/lib/image";
import { useSettings } from "@/lib/settings/SettingsProvider";
import { CaptureCancelledError, capturePhoto, choosePhotos, type PhotoSource } from "@/services/camera";
import { preloadCodeReader, readCodes } from "@/services/codeReader";
import { isSavingData } from "@/services/dataSaver";
import { haptics } from "@/services/device";
import { notify } from "@/services/notifications";
import { ensureCameraAccess } from "@/services/permissions";
import { createId } from "@/services/historyStore";
import { compactOldPhotos } from "@/services/photoStorage";
import { planStore } from "@/services/plan";
import { isOffline, saveScan, sendScan, type ScanJob } from "@/services/scanPipeline";
import { scanQueue } from "@/services/scanQueue";
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
  | "plan_required"
  | "plan_limit"
  | "invalid_request"
  | "upstream_error"
  | "image"
  | "camera"
  | "notImage"
  | "unknown";

export type ScanState =
  | { phase: "idle" }
  /** Taking the pages of a document (multi-page scan). */
  | { phase: "collecting" }
  | { phase: "preparing"; previewSrc: string }
  /** The photo is a QR code: its content, before (or instead of) an analysis. */
  | { phase: "codes"; previewSrc: string; codes: ScannedCode[] }
  | { phase: "analyzing"; previewSrc: string; startedAt: number; pageCount: number }
  /** No network: the scan waits on the device and leaves once it is back. */
  | { phase: "queued"; previewSrc: string }
  | { phase: "error"; previewSrc?: string; error: ScanErrorKind };

/** A page of a multi-page scan, with a key that follows it when pages are reordered. */
export type PageCapture = PreparedCapture & { key: string };

export function toErrorKind(error: unknown): ScanErrorKind {
  if (error instanceof ApiError) {
    const code = error.code;
    return code === "method_not_allowed" || code === "ask_limit" || code === "deep_limit" || code === "second_factor" ? "unknown" : code;
  }
  return "unknown";
}

function revoke(src: string) {
  if (src.startsWith("blob:")) URL.revokeObjectURL(src);
}

/**
 * The capture → prepare → analyse → save pipeline behind the scan screen,
 * with its detours: the pages of a document, a QR code read on the spot,
 * and the queue when there is no network.
 */
export function useScan(mode: ScanMode) {
  const router = useRouter();
  const { settings } = useSettings();
  const { t, locale } = useTranslation();
  const reminderTexts = useReminderTexts();
  const [state, setState] = useState<ScanState>({ phase: "idle" });
  const [pages, setPages] = useState<PageCapture[]>([]);
  const [addingPage, setAddingPage] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const lastJobRef = useRef<ScanJob | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);
  // Ready to read QR codes even if the next photo is taken offline.
  useEffect(() => preloadCodeReader(), []);

  const queue = useCallback(async (job: ScanJob) => {
    await scanQueue.add(job);
    lastJobRef.current = null;
    haptics.success();
    setState({ phase: "queued", previewSrc: job.first.preview.dataUrl });
  }, []);

  const analyze = useCallback(
    async (job: ScanJob) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      lastJobRef.current = job;
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        await queue(job);
        return;
      }
      setState({ phase: "analyzing", previewSrc: job.first.preview.dataUrl, startedAt: Date.now(), pageCount: job.pages.length + 1 });

      try {
        const response = await sendScan(job, controller.signal);
        const id = await saveScan(job, response, reminderTexts.insurance);
        haptics.success();
        if (settings.notifyOnResult && document.visibilityState === "hidden") {
          void notify({ title: t("notifications.readyTitle"), body: response.analysis.title, entryId: id });
        }
        lastJobRef.current = null;
        void compactOldPhotos().catch(() => undefined);
        await router.push({ pathname: "/result", query: { id } });
        setState({ phase: "idle" });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isOffline(error)) {
          await queue(job);
          return;
        }
        if (error instanceof ApiError && (error.code === "trial_exhausted" || error.code === "plan_limit")) planStore.markScansUsedUp();
        haptics.error();
        setState({ phase: "error", previewSrc: job.first.preview.dataUrl, error: toErrorKind(error) });
      }
    },
    [queue, reminderTexts, router, settings.notifyOnResult, t],
  );

  const prepareAndAnalyze = useCallback(
    async (src: string) => {
      setState({ phase: "preparing", previewSrc: src });
      let prepared: PreparedCapture;
      let codes: ScannedCode[];
      let mainSubject: boolean;
      try {
        // The codes are read while the photo is resized: no extra wait.
        [prepared, { codes, mainSubject }] = await Promise.all([prepareCapture(src, { light: isSavingData() }), readCodes(src)]);
      } catch {
        setState({ phase: "error", error: "image" });
        return;
      } finally {
        revoke(src);
      }

      const job: ScanJob = { mode, locale, first: prepared, pages: [], codes };
      if (mainSubject) {
        // A QR code shot up close: its content right away, no scan spent.
        lastJobRef.current = job;
        haptics.success();
        setState({ phase: "codes", previewSrc: prepared.preview.dataUrl, codes });
        return;
      }
      await analyze(job);
    },
    [analyze, locale, mode],
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

  /** A photo shared from another app (WhatsApp, the gallery…). */
  const startWithSrc = useCallback((src: string) => prepareAndAnalyze(src), [prepareAndAnalyze]);

  // ---- Multi-page scan ------------------------------------------------------------

  const addPageSources = useCallback(async (sources: string[]) => {
    setAddingPage(true);
    try {
      for (const src of sources) {
        try {
          const page = { ...(await prepareCapture(src, { light: isSavingData(), page: true })), key: createId() };
          setPages((current) => (current.length < MAX_PAGES ? [...current, page] : current));
        } catch {
          // An unreadable file is skipped; the others are kept.
        } finally {
          revoke(src);
        }
      }
    } finally {
      setAddingPage(false);
    }
  }, []);

  /** Opens the pages tray, optionally with photos already chosen (shared from another app). */
  const beginPages = useCallback(
    (sources: string[] = []) => {
      setPages([]);
      setState({ phase: "collecting" });
      if (sources.length > 0) void addPageSources(sources.slice(0, MAX_PAGES));
    },
    [addPageSources],
  );

  const addPage = useCallback(
    async (source: PhotoSource) => {
      haptics.press();
      const room = MAX_PAGES - pages.length;
      if (room <= 0) return;
      if (source === "camera" && !(await ensureCameraAccess())) {
        haptics.error();
        return;
      }
      try {
        const sources = source === "camera" ? [await capturePhoto("camera")] : await choosePhotos(room);
        await addPageSources(sources);
      } catch {
        // Cancelled, or no camera: the pages taken so far stay.
      }
    },
    [addPageSources, pages.length],
  );

  const removePage = useCallback((index: number) => {
    haptics.tap();
    setPages((current) => current.filter((_, position) => position !== index));
  }, []);

  const movePage = useCallback((index: number, offset: -1 | 1) => {
    setPages((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const analyzePages = useCallback(async () => {
    if (pages.length === 0) return;
    const [first, ...rest] = pages;
    setState({ phase: "preparing", previewSrc: first.preview.dataUrl });
    // Codes on the first page are shown on the result; they never replace the analysis here.
    const { codes } = await readCodes(first.upload.dataUrl);
    setPages([]);
    await analyze({ mode, locale, first, pages: rest, codes });
  }, [analyze, locale, mode, pages]);

  // ---- Retry, reset --------------------------------------------------------------

  /** From the codes screen: analyse the photo anyway. */
  const analyzeAnyway = useCallback(() => {
    if (lastJobRef.current) void analyze(lastJobRef.current);
  }, [analyze]);

  const retry = useCallback(() => {
    if (lastJobRef.current) void analyze(lastJobRef.current);
  }, [analyze]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    lastJobRef.current = null;
    setPages([]);
    setState({ phase: "idle" });
  }, []);

  return {
    state,
    start,
    startWithFile,
    startWithSrc,
    retry,
    reset,
    analyzeAnyway,
    canRetry: state.phase === "error" && Boolean(state.previewSrc),
    pages: { list: pages, adding: addingPage, begin: beginPages, add: addPage, remove: removePage, move: movePage, analyze: analyzePages },
  };
}
