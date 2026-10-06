import { useEffect, useState } from "react";
import type { AiProvider } from "@/lib/ai/schema";
import { aiKeyStore } from "@/services/aiKeyStore";
import { analysisService } from "@/services/analysisService";

export type AiStatus = {
  status: "checking" | "live" | "demo" | "offline";
  provider?: AiProvider;
  model?: string;
  /** True when analyses run on the user's own key rather than the server's. */
  ownKey?: boolean;
};

/** Which AI engine analyses run on: the user's own key, the server's, or demo samples. */
export function useAiStatus() {
  const [server, setServer] = useState<AiStatus>({ status: "checking" });
  const [own, setOwn] = useState<AiStatus | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    analysisService
      .health(controller.signal)
      .then((health) => setServer({ status: health.ai, provider: health.provider, model: health.model }))
      .catch(() => {
        if (!controller.signal.aborted) setServer({ status: "offline" });
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const load = () =>
      void aiKeyStore
        .get()
        .then((override) =>
          setOwn(override ? { status: "live", provider: override.provider, model: override.model, ownKey: true } : null),
        );
    load();
    return aiKeyStore.subscribe(load);
  }, []);

  // Without the server the user's key can't be used either.
  return own && server.status !== "offline" ? own : server;
}
