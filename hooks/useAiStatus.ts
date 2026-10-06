import { useEffect, useState } from "react";
import { providerLabel } from "@/lib/ai/presets";
import { aiKeyStore } from "@/services/aiKeyStore";
import { analysisService } from "@/services/analysisService";

export type AiStatus = {
  status: "checking" | "live" | "demo" | "offline";
  /** Display name of the engine: "Gemini", "Claude", "OpenAI", a custom host… */
  label?: string;
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
      .then((health) =>
        setServer({
          status: health.ai,
          label: health.provider === "gemini" ? "Gemini" : health.provider === "claude" ? "Claude" : undefined,
          model: health.model,
        }),
      )
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
          setOwn(
            override
              ? {
                  status: "live",
                  label: providerLabel(override.presetId, override.provider === "openai" ? override.baseUrl : undefined),
                  model: override.model,
                  ownKey: true,
                }
              : null,
          ),
        );
    load();
    return aiKeyStore.subscribe(load);
  }, []);

  // Without the server the user's key can't be used either.
  return own && server.status !== "offline" ? own : server;
}
