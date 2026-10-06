import type { NextApiRequest, NextApiResponse } from "next";
import { AnalysisError } from "@/lib/ai/errors";
import { mockAnalysis } from "@/lib/ai/mock";
import { activeModel, activeProvider, analyzeImage } from "@/lib/ai/provider";
import { AnalyzeRequestSchema, type AnalyzeResponse } from "@/lib/ai/schema";
import { applyCors, clientIp, sendError } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";

export const config = {
  api: {
    // A resized JPEG is usually < 1 MB, but leave room for the 5 MB image cap.
    bodyParser: { sizeLimit: "7mb" },
  },
  // Vision analysis with thinking can take a while; raise the serverless timeout.
  maxDuration: 60,
};

const RATE_LIMIT = { requests: 12, windowMs: 60_000 };
const DEMO_LATENCY_MS = 2200;

export default async function handler(req: NextApiRequest, res: NextApiResponse<AnalyzeResponse | unknown>) {
  if (applyCors(req, res, ["POST"])) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return sendError(res, 405, "method_not_allowed", "Use POST.");
  }

  const limit = rateLimit(`analyze:${clientIp(req)}`, RATE_LIMIT.requests, RATE_LIMIT.windowMs);
  if (!limit.ok) {
    res.setHeader("Retry-After", String(limit.retryAfterS));
    return sendError(res, 429, "rate_limited", "Too many analyses, try again in a moment.");
  }

  const parsed = AnalyzeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid request body.");
  }

  const startedAt = Date.now();

  if (activeProvider === "demo") {
    await new Promise((resolve) => setTimeout(resolve, DEMO_LATENCY_MS));
    return res.status(200).json({
      analysis: mockAnalysis(parsed.data.mode, parsed.data.locale),
      meta: { model: "demo", demo: true, durationMs: Date.now() - startedAt },
    } satisfies AnalyzeResponse);
  }

  // Stop paying for tokens if the user cancels or leaves the screen.
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  try {
    const { analysis, model } = await analyzeImage(parsed.data, abort.signal);
    return res.status(200).json({
      analysis: { ...analysis, confidence: Math.min(1, Math.max(0, analysis.confidence)) },
      meta: { model, demo: false, durationMs: Date.now() - startedAt },
    } satisfies AnalyzeResponse);
  } catch (error) {
    if (abort.signal.aborted) return;
    if (error instanceof AnalysisError) {
      if (error.status >= 500 || error.code === "billing") console.error(`[analyze:${activeProvider}]`, error.message);
      return sendError(res, error.status, error.code, error.message);
    }
    console.error(`[analyze:${activeProvider}] unexpected`, error);
    return sendError(res, 500, "upstream_error", `Something went wrong (${activeModel}).`);
  }
}
