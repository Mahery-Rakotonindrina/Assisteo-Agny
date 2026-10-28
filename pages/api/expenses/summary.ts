import type { NextApiRequest, NextApiResponse } from "next";
import { AnalysisError } from "@/lib/ai/errors";
import { mockExpenseSummary } from "@/lib/ai/mock";
import { activeProvider, summarizeExpenses } from "@/lib/ai/provider";
import { ExpenseSummaryRequestSchema, type ExpenseSummaryResponse } from "@/lib/ai/schema";
import { hasFeature } from "@/lib/plans";
import { applyCors, clientIp, sendError } from "@/lib/server/http";
import { resolvePlan } from "@/lib/server/plan";
import { rateLimit } from "@/lib/server/rateLimit";
import { reportError } from "@/lib/server/reportError";
import { track } from "@/lib/server/stats";

export const config = { maxDuration: 60 };

/** Reviews a day per account: each one is a call on the server's AI key. */
const SUMMARIES_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "Mes dépenses": the month's review by the AI. The app sends the month's
 * totals only (no note, no shop, no single expense). Admin plan only.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse<ExpenseSummaryResponse | unknown>) {
  if (applyCors(req, res, ["POST"])) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return sendError(res, 405, "method_not_allowed", "Use POST.");
  }

  const burst = await rateLimit(`summary:${clientIp(req)}`, 5, 60_000);
  if (!burst.ok) return sendError(res, 429, "rate_limited", "Too many reviews, try again in a moment.");

  const parsed = ExpenseSummaryRequestSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid request.");

  // Demo mode (no AI key on the server): a sample review, like the demo scans.
  if (activeProvider === "demo") {
    return res.status(200).json({ summary: mockExpenseSummary(parsed.data), model: "demo", demo: true } satisfies ExpenseSummaryResponse);
  }

  const { account, current } = await resolvePlan(req);
  if (!account || !hasFeature(current.plan, "expenses")) {
    return sendError(res, 403, "plan_required", "The month's review is not part of your plan.");
  }

  const daily = await rateLimit(`summary:day:${account.id}`, SUMMARIES_PER_DAY, DAY_MS);
  if (!daily.ok) {
    res.setHeader("Retry-After", String(daily.retryAfterS));
    return sendError(res, 429, "rate_limited", "Today's reviews are used up, come back tomorrow.");
  }

  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  try {
    const { summary, model, usage } = await summarizeExpenses(parsed.data, abort.signal);
    if (usage) await track({ type: "ai", kind: "summary", model, ...usage });
    return res.status(200).json({ summary, model, demo: false } satisfies ExpenseSummaryResponse);
  } catch (error) {
    if (abort.signal.aborted) return;
    await track({ type: "error", route: "summary", code: error instanceof AnalysisError ? error.code : "upstream_error" });
    if (error instanceof AnalysisError) {
      if (error.code === "invalid_key") return sendError(res, 503, "unavailable", "The AI service is not configured correctly.");
      if (error.status >= 500) {
        console.error(`[summary:${activeProvider}]`, error.message);
        await reportError(error, { route: "summary", engine: activeProvider, code: error.code });
      }
      return sendError(res, error.status, error.code, error.message);
    }
    console.error("[summary] unexpected", error instanceof Error ? error.message : error);
    await reportError(error, { route: "summary", kind: "unexpected" });
    return sendError(res, 500, "upstream_error", "Something went wrong.");
  }
}
