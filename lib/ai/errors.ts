import type { ApiErrorCode, VerifyFailure } from "./schema";

/** Provider-agnostic failure, mapped to an HTTP response by the API route. */
export class AnalysisError extends Error {
  constructor(
    public code: Exclude<ApiErrorCode, "method_not_allowed">,
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "AnalysisError";
  }
}

/** Maps an engine failure to what the key setup screen can explain. */
export function toVerifyFailure(error: unknown): { reason: VerifyFailure; detail?: string } {
  if (!(error instanceof AnalysisError)) return { reason: "error" };
  if (error.code === "invalid_key") return { reason: "invalid_key" };
  if (error.code === "billing") return { reason: "billing" };
  if (error.code === "rate_limited") return { reason: "rate_limited" };
  if (error.status === 404) return { reason: "model_unavailable" };
  // URL checks and provider 400s carry a message worth showing as-is.
  if (error.code === "invalid_request") return { reason: "bad_url", detail: error.message };
  if (error.code === "unavailable") return { reason: "bad_url", detail: error.message };
  return { reason: "error", detail: error.message };
}
