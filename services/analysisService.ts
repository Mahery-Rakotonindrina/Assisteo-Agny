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
import { httpClient } from "./httpClient";
import { usableAiKey } from "./plan";
import { installIdHeaders } from "./trial";

export const analysisService = {
  /** Uses the user's own key when one is saved and the plan allows it, else the server's engine. */
  async analyze(payload: AnalyzeRequest, signal?: AbortSignal) {
    const override = await usableAiKey();
    // Own key: no limits. Otherwise the install id and the account let the
    // server count trial or plan scans; sent either way (the plan is checked
    // for an own key too, and the install id feeds the active-device estimate).
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
