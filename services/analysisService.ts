import {
  overrideHeaders,
  type AiOverride,
  type AnalyzeRequest,
  type AnalyzeResponse,
  type HealthResponse,
  type VerifyKeyResponse,
} from "@/lib/ai/schema";
import { aiKeyStore } from "./aiKeyStore";
import { httpClient } from "./httpClient";

export const analysisService = {
  /** Uses the user's own key when one is saved, else the server's engine. */
  async analyze(payload: AnalyzeRequest, signal?: AbortSignal) {
    const override = await aiKeyStore.get();
    const headers: Record<string, string> = override
      ? {
          [overrideHeaders.provider]: override.provider,
          [overrideHeaders.apiKey]: override.apiKey,
          [overrideHeaders.model]: override.model,
        }
      : {};
    return httpClient.post<AnalyzeResponse>("/api/analyze", payload, { signal, headers });
  },

  verifyKey(override: AiOverride, signal?: AbortSignal) {
    return httpClient.post<VerifyKeyResponse>("/api/verify-key", override, { signal });
  },

  health(signal?: AbortSignal) {
    return httpClient.get<HealthResponse>("/api/health", { signal });
  },
};
