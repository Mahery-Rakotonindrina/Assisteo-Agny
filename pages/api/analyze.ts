import type { NextApiRequest, NextApiResponse } from "next";
import { AnalysisError } from "@/lib/ai/errors";
import { mockAnalysis } from "@/lib/ai/mock";
import { activeModel, activeProvider, analyzeImage, readOverride } from "@/lib/ai/provider";
import { AnalyzeRequestSchema, InstallIdSchema, installIdHeader, type AnalyzeResponse, type TrialState } from "@/lib/ai/schema";
import { applyCors, clientIp, sendError } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";
import { bonusScansLeft, noteDevice, returnBonusScan, rewardFirstScan, takeBonusScan } from "@/lib/server/referralBonus";
import { reportError } from "@/lib/server/reportError";
import { track } from "@/lib/server/stats";
import { limitsFor, resolvePlan } from "@/lib/server/plan";
import {
  countServerCall,
  getTrialConfig,
  releasePlanDeep,
  releasePlanScan,
  releaseServerCall,
  releaseTrialAiCall,
  releaseTrialScan,
  reservePlanDeep,
  reservePlanScan,
  reserveServerCall,
  reserveTrialAiCall,
  reserveTrialScan,
  type TrialSubject,
} from "@/lib/server/trialStore";

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

  const limit = await rateLimit(`analyze:${clientIp(req)}`, RATE_LIMIT.requests, RATE_LIMIT.windowMs);
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
  // Anonymous usage counters (lib/server/stats.ts); the id is only hashed into a device estimate.
  const statsDevice = InstallIdSchema.safeParse(req.headers[installIdHeader]).data ?? null;

  if (!override && activeProvider === "demo") {
    await new Promise((resolve) => setTimeout(resolve, DEMO_LATENCY_MS));
    return res.status(200).json({
      analysis: mockAnalysis(parsed.data.mode, parsed.data.locale),
      meta: { model: "demo", demo: true, durationMs: Date.now() - startedAt },
    } satisfies AnalyzeResponse);
  }

  // The plan comes from the signed-in account's subscriptions (free when signed out).
  const { account, current, features, quotas, onTrial } = await resolvePlan(req);
  if (override && !features.has("ownKey")) {
    return sendError(res, 403, "plan_required", "Your own AI key needs a subscription.");
  }
  // Several pages in one scan: by the plan's features (Premium and up by default), own key or not.
  if ((parsed.data.pages?.length ?? 0) > 0 && !features.has("multiPage")) {
    return sendError(res, 403, "plan_required", "Multi-page scans are not part of your plan.");
  }
  // A deep analysis uses the server's bigger model; with an own key, the user's model applies.
  const deep = Boolean(parsed.data.deep) && !override;
  if (deep && !features.has("deepAnalysis")) {
    return sendError(res, 403, "plan_required", "Deep analyses are not part of your plan.");
  }

  // Without their own key, a subscriber spends one of the month's scans...
  let quota: (TrialState & { userId: string }) | null = null;
  let deepQuota: TrialState | null = null;
  let trialAi = false;
  // A scan won through a referral, spent once the plan's own are used up: given back if the analysis fails.
  let planBonus: string | null = null;
  const giveBackPlanScan = (userId: string) => (planBonus ? returnBonusScan(planBonus) : releasePlanScan(userId));
  if (!override && current.plan !== "free" && account) {
    const { scans, deepPerMonth } = await limitsFor(current.plan, undefined, quotas, features);
    let usage = await reservePlanScan(account.id, scans);
    if (usage === null && account.email && (await takeBonusScan(account.email))) {
      planBonus = account.email;
      usage = { used: scans, limit: scans + (await bonusScansLeft(account.email)) };
    }
    if (usage === null) {
      await track({ type: "error", route: "analyze", code: "plan_limit" }, statsDevice);
      return sendError(res, 403, "plan_limit", "This month's scans are used up.");
    }
    // A deep analysis also counts against the month's deep analyses.
    if (deep) {
      deepQuota = await reservePlanDeep(account.id, deepPerMonth);
      if (!deepQuota) {
        await giveBackPlanScan(account.id).catch(() => undefined);
        await track({ type: "error", route: "analyze", code: "deep_limit" }, statsDevice);
        return sendError(res, 403, "deep_limit", "This month's deep analyses are used up.");
      }
    }
    // A Premium trial's calls share a daily cap of their own (an account is free to make).
    if (onTrial) {
      if (!(await reserveTrialAiCall())) {
        await Promise.all([giveBackPlanScan(account.id), deepQuota && releasePlanDeep(account.id)]).catch(() => undefined);
        await track({ type: "error", route: "analyze", code: "server_busy" }, statsDevice);
        return sendError(res, 503, "server_busy", "The trial's AI has reached today's limit: come back tomorrow.");
      }
      trialAi = true;
    }
    // Subscribers are counted in the daily total but never turned away by it.
    await countServerCall();
    quota = { userId: account.id, used: usage.used, limit: usage.limit };
  }

  // ...anyone else one of the free trial scans.
  let trial: (TrialState & { subject: TrialSubject; ip: string; bonusEmail: string | null }) | null = null;
  const giveBackTrial = (booked: NonNullable<typeof trial>) => (booked.bonusEmail ? returnBonusScan(booked.bonusEmail) : releaseTrialScan(booked.subject, booked.ip));
  if (!override && !quota) {
    const installId = InstallIdSchema.safeParse(req.headers[installIdHeader]);
    if (!installId.success) {
      return sendError(res, 400, "invalid_request", "Missing install id: update the app.");
    }
    const ip = clientIp(req);
    // Signed in: the account's count applies too (an invalid token just counts as signed out).
    const subject: TrialSubject = { installId: installId.data, userId: account?.id ?? null };
    let usage = await reserveTrialScan(subject, ip);
    let bonusEmail: string | null = null;
    // The free trial is over: a scan won through a referral goes on.
    if (usage === null && account?.email && (await takeBonusScan(account.email))) {
      bonusEmail = account.email;
      const { limit } = await getTrialConfig();
      usage = { used: limit, limit: limit + (await bonusScansLeft(account.email)) };
    }
    if (usage === null) {
      await track({ type: "error", route: "analyze", code: "trial_exhausted" }, statsDevice);
      return sendError(res, 403, "trial_exhausted", "The free trial is over: choose a plan to continue.");
    }
    if (!(await reserveServerCall())) {
      await (bonusEmail ? returnBonusScan(bonusEmail) : releaseTrialScan(subject, ip)).catch(() => undefined);
      await track({ type: "error", route: "analyze", code: "server_busy" }, statsDevice);
      return sendError(res, 503, "server_busy", "The free AI has reached today's limit: come back tomorrow.");
    }
    trial = { subject, ip, ...usage, bonusEmail };
  }

  // A deep analysis offered to a free account counts too, under the emergency cap (never without a limit).
  let freeDeep: string | null = null;
  if (deep && !quota && account) {
    const { deepPerMonth } = await limitsFor(current.plan, undefined, quotas, features);
    deepQuota = await reservePlanDeep(account.id, deepPerMonth);
    if (!deepQuota) {
      if (trial) await Promise.all([giveBackTrial(trial), releaseServerCall()]).catch(() => undefined);
      await track({ type: "error", route: "analyze", code: "deep_limit" }, statsDevice);
      return sendError(res, 403, "deep_limit", "This month's deep analyses are used up.");
    }
    freeDeep = account.id;
  }

  // Stop paying for tokens if the user cancels or leaves the screen.
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  try {
    const { analysis, model, usage } = await analyzeImage(parsed.data, abort.signal, override, deep);
    // What the server's key spent (an own key costs us nothing).
    if (!override && usage) await track({ type: "ai", kind: deep ? "deep" : "scan", model, ...usage });
    await track(
      { type: "scan", mode: parsed.data.mode, category: analysis.category, ownKey: Boolean(override), durationMs: Date.now() - startedAt },
      statsDevice,
    );
    // A friend's first scan on the server's AI, with a confirmed account: the referral bonus (never blocks the answer).
    if (!override && account?.email) {
      await rewardFirstScan({ email: account.email, installId: statsDevice, ip: clientIp(req) })
        .then(() => noteDevice(account.email!, statsDevice, clientIp(req)))
        .catch(() => undefined);
    }
    return res.status(200).json({
      analysis: { ...analysis, confidence: Math.min(1, Math.max(0, analysis.confidence)) },
      meta: {
        model,
        demo: false,
        durationMs: Date.now() - startedAt,
        ...(trial && { trial: { used: trial.used, limit: trial.limit } }),
        ...(quota && { quota: { used: quota.used, limit: quota.limit } }),
        ...(deep && { deep: true }),
        ...(deepQuota && { deepQuota }),
      },
    } satisfies AnalyzeResponse);
  } catch (error) {
    // The caller hung up: the AI may already have been billed, so nothing is given back.
    if (abort.signal.aborted) return;
    // A failure on the provider's side doesn't consume a trial scan.
    if (trial) await Promise.all([giveBackTrial(trial), releaseServerCall(), freeDeep && releasePlanDeep(freeDeep)]).catch(() => undefined);
    if (quota) await Promise.all([giveBackPlanScan(quota.userId), releaseServerCall(), deepQuota && releasePlanDeep(quota.userId), trialAi && releaseTrialAiCall()]).catch(() => undefined);
    await track({ type: "error", route: "analyze", code: error instanceof AnalysisError ? error.code : "upstream_error" }, statsDevice);
    const engine = override ? `user-${override.provider}` : activeProvider;
    // The bigger model refused on the server's key (no quota or billing for it, model gone): ours to fix.
    if (deep && error instanceof AnalysisError && ["rate_limited", "billing", "unavailable", "invalid_request"].includes(error.code)) {
      console.error(`[analyze:${engine}] deep analysis unavailable`, error.message);
      await reportError(error, { route: "analyze", engine, kind: "deep_unavailable", code: error.code });
      return sendError(res, 503, "unavailable", "Deep analysis is unavailable right now.");
    }
    if (error instanceof AnalysisError) {
      // A rejected server key is a deployment problem, not something the user can fix.
      if (!override && error.code === "invalid_key") {
        console.error(`[analyze:${engine}] server key rejected`);
        await reportError(error, { route: "analyze", engine, kind: "server_key_rejected" });
        return sendError(res, 503, "unavailable", "The AI service is not configured correctly.");
      }
      if (error.status >= 500 || error.code === "billing") {
        console.error(`[analyze:${engine}]`, error.message);
        // The user's own key failing is their business; the server's is ours.
        if (!override) await reportError(error, { route: "analyze", engine, code: error.code });
      }
      return sendError(res, error.status, error.code, error.message);
    }
    console.error(`[analyze:${engine}] unexpected`, error instanceof Error ? error.message : error);
    await reportError(error, { route: "analyze", engine, kind: "unexpected" });
    return sendError(res, 500, "upstream_error", "Something went wrong.");
  }
}
