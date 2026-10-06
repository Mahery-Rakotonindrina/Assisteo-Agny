import type { NextApiRequest, NextApiResponse } from "next";
import { toVerifyFailure } from "@/lib/ai/errors";
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
    return res.status(200).json({ ok: false, reason: "bad_url", detail: parsed.error.issues[0]?.message } satisfies VerifyKeyResponse);
  }

  try {
    await verifyKey(parsed.data);
    return res.status(200).json({ ok: true, model: parsed.data.model } satisfies VerifyKeyResponse);
  } catch (error) {
    const failure = toVerifyFailure(error);
    if (failure.reason === "error") console.error(`[verify-key:${parsed.data.provider}]`, failure.detail ?? error);
    return res.status(200).json({ ok: false, ...failure } satisfies VerifyKeyResponse);
  }
}
