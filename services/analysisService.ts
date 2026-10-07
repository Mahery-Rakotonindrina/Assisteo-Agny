import {
  overrideHeaders,
  type AiOverride,
  type AnalyzeRequest,
  type AnalyzeResponse,
  type HealthResponse,
  type ListModelsRequest,
  type ListModelsResponse,
  type VerifyKeyResponse,
} from "@/lib/ai/schema";
import { aiKeyStore } from "./aiKeyStore";
import { httpClient } from "./httpClient";
import { installIdHeaders } from "./trial";

export const analysisService = {
  /** Uses the user's own key when one is saved, else the server's engine. */
  async analyze(payload: AnalyzeRequest, signal?: AbortSignal) {
    const override = await aiKeyStore.get();
    // Own key: no limits. Otherwise the install id lets the server count trial
    // scans; it's sent either way for the anonymous active-device estimate.
    const headers: Record<string, string> = {
      ...(await installIdHeaders()),
      ...(override && {
        [overrideHeaders.provider]: override.provider,
        [overrideHeaders.apiKey]: override.apiKey,
        [overrideHeaders.model]: override.model,
        ...(override.provider === "openai" && { [overrideHeaders.baseUrl]: override.baseUrl }),
      }),
    };
    return httpClient.post<AnalyzeResponse>("/api/analyze", payload, { signal, headers });
  },

  verifyKey(override: AiOverride, signal?: AbortSignal) {
    return httpClient.post<VerifyKeyResponse>("/api/verify-key", override, { signal });
  },

  listModels(request: ListModelsRequest, signal?: AbortSignal) {
    return httpClient.post<ListModelsResponse>("/api/list-models", request, { signal });
  },

  health(signal?: AbortSignal) {
    return httpClient.get<HealthResponse>("/api/health", { signal });
  },
};
