import type { NextApiRequest, NextApiResponse } from "next";
import { AnalysisError } from "@/lib/ai/errors";
import { mockStatement } from "@/lib/ai/mock";
import { activeProvider, readStatement } from "@/lib/ai/provider";
import { MAX_STATEMENT_PAGES, StatementRequestSchema, type Statement, type StatementResponse } from "@/lib/ai/schema";
import { applyCors, clientIp, sendError } from "@/lib/server/http";
import { isPdf, pdfPageCount } from "@/lib/server/pdfPages";
import { limitsFor, resolvePlan } from "@/lib/server/plan";
import { rateLimit, refundRateLimit } from "@/lib/server/rateLimit";
import { reportError } from "@/lib/server/reportError";
import { track } from "@/lib/server/stats";
import { countServerCall, releasePlanScan, reservePlanScan } from "@/lib/server/trialStore";

export const config = {
  // Up to 10 screenshots, or a PDF of up to 3 MB (the host caps a request at 4.5 MB).
  api: { bodyParser: { sizeLimit: "8mb" } },
  maxDuration: 60,
};

/** Statements a day per account, on top of the month's scans. */
const STATEMENTS_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
/** More operations than any month of a household: the rest is dropped. */
const MAX_OPERATIONS = 400;

/** Keeps the operations worth importing: a positive amount, never more than MAX_OPERATIONS. */
function cleaned(statement: Statement): Statement {
  return { ...statement, operations: statement.operations.filter((operation) => Number.isFinite(operation.amount) && operation.amount > 0).slice(0, MAX_OPERATIONS) };
}

/**
 * "Mes dépenses": every operation of a Mobile Money or bank statement, read by
 * the AI from screenshots of the history or the statement's PDF. Nothing is
 * kept: the images go to the AI and are forgotten. Each page counts as one of
 * the month's scans, given back when the reading fails.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse<StatementResponse | unknown>) {
  if (applyCors(req, res, ["POST"])) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return sendError(res, 405, "method_not_allowed", "Use POST.");
  }

  const burst = await rateLimit(`statement:${clientIp(req)}`, 5, 60_000);
  if (!burst.ok) {
    res.setHeader("Retry-After", String(burst.retryAfterS));
    return sendError(res, 429, "rate_limited", "Too many statements, try again in a moment.");
  }

  const parsed = StatementRequestSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid request.");
  const { pdf } = parsed.data;
  if (pdf && !isPdf(pdf)) return sendError(res, 400, "invalid_request", "This file is not a PDF.");
  const pages = pdf ? pdfPageCount(pdf) : (parsed.data.pages?.length ?? 1);
  if (pages > MAX_STATEMENT_PAGES) return sendError(res, 400, "invalid_request", `At most ${MAX_STATEMENT_PAGES} pages.`);

  // Demo mode (no AI key on the server): a sample MVola history, like the demo scans.
  if (activeProvider === "demo") {
    return res.status(200).json({ statement: mockStatement(Date.now()), model: "demo", demo: true, pages } satisfies StatementResponse);
  }

  const { account, current, features } = await resolvePlan(req);
  if (!account) return sendError(res, 401, "sign_in_required", "Sign in to import a statement.");
  if (!features.has("expenses")) return sendError(res, 403, "plan_required", "Importing a statement is not part of your plan.");

  const dailyKey = `statement:day:${account.id}`;
  const daily = await rateLimit(dailyKey, STATEMENTS_PER_DAY, DAY_MS);
  if (!daily.ok) {
    res.setHeader("Retry-After", String(daily.retryAfterS));
    return sendError(res, 429, "rate_limited", "Today's statements are used up, come back tomorrow.");
  }

  // Each page is one of the month's scans (a plan without a monthly count: the daily cap only).
  let booked = 0;
  const giveBack = async () => {
    await refundRateLimit(dailyKey, DAY_MS);
    for (; booked > 0; booked -= 1) await releasePlanScan(account.id).catch(() => undefined);
  };
  if (current.plan !== "free") {
    const { scans } = await limitsFor(current.plan);
    for (let page = 0; page < pages; page += 1) {
      if (!(await reservePlanScan(account.id, scans))) {
        await giveBack();
        await track({ type: "error", route: "statement", code: "plan_limit" });
        return sendError(res, 403, "plan_limit", "This month's scans are used up.");
      }
      booked += 1;
    }
    await countServerCall();
  }

  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  try {
    const { statement, model, usage } = await readStatement(parsed.data, abort.signal);
    if (usage) await track({ type: "ai", kind: "statement", model, ...usage });
    return res.status(200).json({ statement: cleaned(statement), model, demo: false, pages } satisfies StatementResponse);
  } catch (error) {
    // The caller hung up: the AI may already have been billed, so the pages still count.
    if (abort.signal.aborted) return;
    // A reading that failed on our side counts neither in the day's nor in the month's.
    await giveBack();
    await track({ type: "error", route: "statement", code: error instanceof AnalysisError ? error.code : "upstream_error" });
    if (error instanceof AnalysisError) {
      if (error.code === "invalid_key") return sendError(res, 503, "unavailable", "The AI service is not configured correctly.");
      if (error.status >= 500) {
        console.error(`[statement:${activeProvider}]`, error.message);
        await reportError(error, { route: "statement", engine: activeProvider, code: error.code });
      }
      return sendError(res, error.status, error.code, error.message);
    }
    console.error("[statement] unexpected", error instanceof Error ? error.message : error);
    await reportError(error, { route: "statement", kind: "unexpected" });
    return sendError(res, 500, "upstream_error", "Something went wrong.");
  }
}
