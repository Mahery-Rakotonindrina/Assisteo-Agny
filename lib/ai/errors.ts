import type { ApiErrorCode } from "./schema";

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
