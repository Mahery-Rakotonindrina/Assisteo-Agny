import type { NextApiRequest, NextApiResponse } from "next";
import { AnalysisError } from "@/lib/ai/errors";
import { verifyKey } from "@/lib/ai/provider";
import { AiOverrideSchema, type VerifyKeyResponse } from "@/lib/ai/schema";
import { applyCors, clientIp, sendError } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";

/**
 * Checks a user's own API key with a tiny request before the app saves it.
 * The key is used for this call only and never stored or logged.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse<VerifyKeyResponse | unknown>) {
  if (applyCors(req, res, ["POST"])) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return sendError(res, 405, "method_not_allowed", "Use POST.");
  }

  const limit = rateLimit(`verify:${clientIp(req)}`, 10, 60_000);
  if (!limit.ok) {
    res.setHeader("Retry-After", String(limit.retryAfterS));
    return sendError(res, 429, "rate_limited", "Too many checks, try again in a moment.");
  }

  const parsed = AiOverrideSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, "invalid_request", "Invalid provider, model or key.");
  }

  try {
    await verifyKey(parsed.data);
    return res.status(200).json({ ok: true, model: parsed.data.model } satisfies VerifyKeyResponse);
  } catch (error) {
    const reason: Extract<VerifyKeyResponse, { ok: false }>["reason"] =
      error instanceof AnalysisError
        ? error.code === "invalid_key"
          ? "invalid_key"
          : error.code === "billing"
            ? "billing"
            : error.code === "rate_limited"
              ? "rate_limited"
              : error.status === 404
                ? "model_unavailable"
                : "error"
        : "error";
    if (reason === "error") console.error(`[verify-key:${parsed.data.provider}]`, error instanceof Error ? error.message : error);
    return res.status(200).json({ ok: false, reason } satisfies VerifyKeyResponse);
  }
}
