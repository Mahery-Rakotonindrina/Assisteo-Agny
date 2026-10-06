import { useEffect, useState } from "react";
import type { AiProvider } from "@/lib/ai/schema";
import { analysisService } from "@/services/analysisService";

export type AiStatus = { status: "checking" | "live" | "demo" | "offline"; provider?: AiProvider; model?: string };

/** Which AI engine the API runs on (Claude, Gemini) or whether it serves demo samples. */
export function useAiStatus() {
  const [aiStatus, setAiStatus] = useState<AiStatus>({ status: "checking" });

  useEffect(() => {
    const controller = new AbortController();
    analysisService
      .health(controller.signal)
      .then((health) => setAiStatus({ status: health.ai, provider: health.provider, model: health.model }))
      .catch(() => {
        if (!controller.signal.aborted) setAiStatus({ status: "offline" });
      });
    return () => controller.abort();
  }, []);

  return aiStatus;
}
