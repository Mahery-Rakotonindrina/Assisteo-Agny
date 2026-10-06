import type { AnalyzeRequest, AnalyzeResponse, HealthResponse } from "@/lib/ai/schema";
import { httpClient } from "./httpClient";

export const analysisService = {
  analyze(payload: AnalyzeRequest, signal?: AbortSignal) {
    return httpClient.post<AnalyzeResponse>("/api/analyze", payload, { signal });
  },

  health(signal?: AbortSignal) {
    return httpClient.get<HealthResponse>("/api/health", { signal });
  },
};
