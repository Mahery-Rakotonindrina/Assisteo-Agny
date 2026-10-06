import type { ApiErrorBody, ApiErrorCode } from "@/lib/ai/schema";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** The machine-readable code sent by our API routes, if any. */
  get code(): ApiErrorCode | "network" | "unknown" {
    if (this.status === 0) return "network";
    const body = this.body as Partial<ApiErrorBody> | undefined;
    return body?.error?.code ?? "unknown";
  }
}
