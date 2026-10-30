import type { NextApiRequest, NextApiResponse } from "next";
import { AnalysisError } from "@/lib/ai/errors";
import { mockObjectAd } from "@/lib/ai/objectAdDemo";
import { activeProvider, writeObjectAd } from "@/lib/ai/provider";
import { AnalysisSchema, InstallIdSchema, installIdHeader, normalizeStoredAnalysis, ObjectAdRequestSchema, type ObjectAdResponse } from "@/lib/ai/schema";
import { tidyAd } from "@/lib/objectAd";
import { applyCors, clientIp, sendError } from "@/lib/server/http";
import { limitsFor, resolvePlan } from "@/lib/server/plan";
import { rateLimit } from "@/lib/server/rateLimit";
import { reportError } from "@/lib/server/reportError";
import { track } from "@/lib/server/stats";
import { countServerCall, releaseAsk, releasePlanAsk, releaseServerCall, reserveAsk, reservePlanAsk, reserveServerCall } from "@/lib/server/trialStore";

export const config = {
  api: { bodyParser: { sizeLimit: "7mb" } },
  maxDuration: 60,
};

const DEMO_LATENCY_MS = 800;

/**
 * Selling an object: the AI writes its classified ad from the scan's photo
 * and analysis. Anyone may, on the server's engine (never an own key): it
 * counts as one of the day's questions, given back when the AI fails.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse<ObjectAdResponse | unknown>) {
  if (applyCors(req, res, ["POST"])) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return sendError(res, 405, "method_not_allowed", "Use POST.");
  }

  const burst = await rateLimit(`object-ad:${clientIp(req)}`, 10, 60_000);
  if (!burst.ok) {
    res.setHeader("Retry-After", String(burst.retryAfterS));
    return sendError(res, 429, "rate_limited", "Too many ads, try again in a moment.");
  }

  const parsed = ObjectAdRequestSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid request.");
  const analysis = AnalysisSchema.safeParse(normalizeStoredAnalysis(parsed.data.analysis));
  if (!analysis.success) return sendError(res, 400, "invalid_request", "Invalid scan context.");
  const input = { ...parsed.data, place: parsed.data.place || undefined, analysis: analysis.data };

  // Demo mode (no AI key on the server): a sample ad, like the demo scans.
  if (activeProvider === "demo") {
    await new Promise((resolve) => setTimeout(resolve, DEMO_LATENCY_MS));
    return res.status(200).json({ ad: mockObjectAd(input, analysis.data.title), model: "demo", demo: true } satisfies ObjectAdResponse);
  }

  const statsDevice = InstallIdSchema.safeParse(req.headers[installIdHeader]).data ?? null;
  const { account, current, features, quotas } = await resolvePlan(req);

  // A subscriber's ad draws on the plan's daily questions...
  let planUser: string | null = null;
  let installId: string | null = null;
  let usage: ObjectAdResponse["usage"];
  if (current.plan !== "free" && account) {
    const { questionsPerDay } = await limitsFor(current.plan, undefined, quotas, features);
    const booked = await reservePlanAsk(account.id, questionsPerDay);
    if (!booked) return sendError(res, 403, "ask_limit", "Today's questions of your plan are used up.");
    await countServerCall();
    planUser = account.id;
    usage = booked;
  } else {
    // ...anyone else's on the daily questions of the install.
    const id = InstallIdSchema.safeParse(req.headers[installIdHeader]);
    if (!id.success) return sendError(res, 400, "invalid_request", "Missing install id: update the app.");
    const booked = await reserveAsk(id.data);
    if (!booked) return sendError(res, 403, "ask_limit", "Today's questions on the server's AI are used up.");
    if (!(await reserveServerCall())) {
      await releaseAsk(id.data).catch(() => undefined);
      return sendError(res, 503, "server_busy", "The free AI has reached today's limit: come back tomorrow.");
    }
    installId = id.data;
    usage = booked;
  }

  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  try {
    const { ad, model, usage: tokens } = await writeObjectAd(input, abort.signal);
    if (tokens) await track({ type: "ai", kind: "ad", model, ...tokens });
    await track({ type: "question", ownKey: false }, statsDevice);
    return res.status(200).json({ ad: tidyAd(ad), model, demo: false, usage } satisfies ObjectAdResponse);
  } catch (error) {
    // A failed or cancelled ad gives the day's question back.
    if (installId) await Promise.all([releaseAsk(installId), releaseServerCall()]).catch(() => undefined);
    if (planUser) await Promise.all([releasePlanAsk(planUser), releaseServerCall()]).catch(() => undefined);
    if (abort.signal.aborted) return;
    await track({ type: "error", route: "object-ad", code: error instanceof AnalysisError ? error.code : "upstream_error" }, statsDevice);
    if (error instanceof AnalysisError) {
      if (error.code === "invalid_key") return sendError(res, 503, "unavailable", "The AI service is not configured correctly.");
      if (error.status >= 500) {
        console.error(`[object-ad:${activeProvider}]`, error.message);
        await reportError(error, { route: "object-ad", engine: activeProvider, code: error.code });
      }
      return sendError(res, error.status, error.code, error.message);
    }
    console.error("[object-ad] unexpected", error instanceof Error ? error.message : error);
    await reportError(error, { route: "object-ad", kind: "unexpected" });
    return sendError(res, 500, "upstream_error", "Something went wrong.");
  }
}
