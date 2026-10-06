import type { NextApiRequest, NextApiResponse } from "next";
import { AnalysisError } from "@/lib/ai/errors";
import { mockAnalysis } from "@/lib/ai/mock";
import { activeModel, activeProvider, analyzeImage, readOverride } from "@/lib/ai/provider";
import { AnalyzeRequestSchema, InstallIdSchema, installIdHeader, type AnalyzeResponse, type TrialState } from "@/lib/ai/schema";
import { applyCors, clientIp, sendError } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";
import { releaseTrialScan, reserveTrialScan, TRIAL_LIMIT } from "@/lib/server/trialStore";

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

  // The user's own key (if any) is used for this request only, never stored or logged.
  const override = readOverride(req.headers);
  if (override === "invalid") {
    return sendError(res, 400, "invalid_request", "Invalid AI provider, model or key.");
  }

  const startedAt = Date.now();

  if (!override && activeProvider === "demo") {
    await new Promise((resolve) => setTimeout(resolve, DEMO_LATENCY_MS));
    return res.status(200).json({
      analysis: mockAnalysis(parsed.data.mode, parsed.data.locale),
      meta: { model: "demo", demo: true, durationMs: Date.now() - startedAt },
    } satisfies AnalyzeResponse);
  }

  // Without their own key, the user spends one of the free trial scans.
  let trial: (TrialState & { installId: string; ip: string }) | null = null;
  if (!override) {
    const installId = InstallIdSchema.safeParse(req.headers[installIdHeader]);
    if (!installId.success) {
      return sendError(res, 400, "invalid_request", "Missing install id: update the app.");
    }
    const ip = clientIp(req);
    const used = await reserveTrialScan(installId.data, ip);
    if (used === null) {
      return sendError(res, 403, "trial_exhausted", "The free trial is over: add your own API key in Settings.");
    }
    trial = { installId: installId.data, ip, used, limit: TRIAL_LIMIT };
  }

  // Stop paying for tokens if the user cancels or leaves the screen.
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  try {
    const { analysis, model } = await analyzeImage(parsed.data, abort.signal, override);
    return res.status(200).json({
      analysis: { ...analysis, confidence: Math.min(1, Math.max(0, analysis.confidence)) },
      meta: {
        model,
        demo: false,
        durationMs: Date.now() - startedAt,
        ...(trial && { trial: { used: trial.used, limit: trial.limit } }),
      },
    } satisfies AnalyzeResponse);
  } catch (error) {
    // A failed or cancelled analysis doesn't consume a trial scan.
    if (trial) await releaseTrialScan(trial.installId, trial.ip).catch(() => undefined);
    if (abort.signal.aborted) return;
    const engine = override ? `user-${override.provider}` : activeProvider;
    if (error instanceof AnalysisError) {
      // A rejected server key is a deployment problem, not something the user can fix.
      if (!override && error.code === "invalid_key") {
        console.error(`[analyze:${engine}] server key rejected`);
        return sendError(res, 503, "unavailable", "The AI service is not configured correctly.");
      }
      if (error.status >= 500 || error.code === "billing") console.error(`[analyze:${engine}]`, error.message);
      return sendError(res, error.status, error.code, error.message);
    }
    console.error(`[analyze:${engine}] unexpected`, error instanceof Error ? error.message : error);
    return sendError(res, 500, "upstream_error", `Something went wrong (${activeModel}).`);
  }
}
