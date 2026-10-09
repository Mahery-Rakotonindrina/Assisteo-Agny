import type { NextApiRequest, NextApiResponse } from "next";
import { AnalysisError } from "@/lib/ai/errors";
import { activeProvider, askQuestion, readOverride } from "@/lib/ai/provider";
import {
  AnalysisSchema,
  AskRequestSchema,
  InstallIdSchema,
  installIdHeader,
  normalizeStoredAnalysis,
  type AskResponse,
} from "@/lib/ai/schema";
import { applyCors, clientIp, sendError } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";
import { reportError } from "@/lib/server/reportError";
import { track } from "@/lib/server/stats";
import { hasFeature } from "@/lib/plans";
import { limitsFor, resolvePlan } from "@/lib/server/plan";
import { countServerCall, releaseAsk, releasePlanAsk, releaseServerCall, reserveAsk, reservePlanAsk, reserveServerCall } from "@/lib/server/trialStore";

export const config = {
  api: { bodyParser: { sizeLimit: "7mb" } },
  maxDuration: 60,
};

const demoAnswers = {
  fr: "Je suis en mode démo : je ne peux pas vraiment répondre à ta question. Ajoute une clé IA (Réglages → Moteur IA) ou configure l'IA du serveur pour discuter de tes scans.",
  en: "I'm in demo mode, so I can't really answer your question. Add an AI key (Settings → AI engine) or set up the server's AI to chat about your scans.",
};

const demoText = {
  transcribe: "FACTURE N° 2026-104\nDate : 8 octobre 2026\n\nRiz 25 kg | 1 | 95 000 Ar\nHuile 5 L | 2 | 60 000 Ar\n\nTotal : 155 000 Ar\n(texte d'exemple, mode démo)",
  translate: "INVOICE No. 2026-104\nDate: 8 October 2026\n\nRice 25 kg | 1 | 95,000 Ar\nOil 5 L | 2 | 60,000 Ar\n\nTotal: 155,000 Ar\n(sample text, demo mode)",
};

/** Answers a follow-up question about a scan, with the photo and the earlier analysis as context. */
export default async function handler(req: NextApiRequest, res: NextApiResponse<AskResponse | unknown>) {
  if (applyCors(req, res, ["POST"])) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return sendError(res, 405, "method_not_allowed", "Use POST.");
  }

  const limit = await rateLimit(`ask:${clientIp(req)}`, 30, 60_000);
  if (!limit.ok) return sendError(res, 429, "rate_limited", "Too many questions, slow down a little.");

  const parsed = AskRequestSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid request.");
  const analysis = AnalysisSchema.safeParse(normalizeStoredAnalysis(parsed.data.analysis));
  if (!analysis.success) return sendError(res, 400, "invalid_request", "Invalid scan context.");

  const override = readOverride(req.headers);
  if (override === "invalid") return sendError(res, 400, "invalid_request", "Invalid AI provider, model or key.");

  const { account, current } = await resolvePlan(req);
  if (override && !hasFeature(current.plan, "ownKey")) {
    return sendError(res, 403, "plan_required", "Your own AI key needs a subscription.");
  }

  if (!override && activeProvider === "demo") {
    const answer = parsed.data.task === "transcribe" || parsed.data.task === "translate" ? demoText[parsed.data.task] : demoAnswers[parsed.data.locale];
    return res.status(200).json({ answer, model: "demo", demo: true } satisfies AskResponse);
  }

  const statsDevice = InstallIdSchema.safeParse(req.headers[installIdHeader]).data ?? null;
  // The other pages of a multi-page scan go along while the plan allows several pages.
  const pages = hasFeature(current.plan, "multiPage") ? parsed.data.pages : undefined;

  // On the server's key, a subscriber's questions draw on the plan's daily allowance...
  let planUser: string | null = null;
  let usage: { used: number; limit: number } | undefined;
  if (!override && current.plan !== "free" && account) {
    const { questionsPerDay } = await limitsFor(current.plan);
    const booked = await reservePlanAsk(account.id, questionsPerDay);
    if (!booked) return sendError(res, 403, "ask_limit", "Today's questions of your plan are used up.");
    await countServerCall();
    planUser = account.id;
    usage = booked;
  }

  // ...anyone else's on a daily allowance per install.
  let installId: string | null = null;
  if (!override && !planUser) {
    const id = InstallIdSchema.safeParse(req.headers[installIdHeader]);
    if (!id.success) return sendError(res, 400, "invalid_request", "Missing install id: update the app.");
    const booked = await reserveAsk(id.data);
    if (!booked) {
      return sendError(res, 403, "ask_limit", "Today's questions on the server's AI are used up.");
    }
    usage = booked;
    if (!(await reserveServerCall())) {
      await releaseAsk(id.data).catch(() => undefined);
      return sendError(res, 503, "server_busy", "The free AI has reached today's limit: come back tomorrow.");
    }
    installId = id.data;
  }

  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  try {
    const { answer, model, usage: tokens } = await askQuestion({ ...parsed.data, pages, analysis: analysis.data }, abort.signal, override);
    if (!override && tokens) await track({ type: "ai", kind: "question", model, ...tokens });
    await track({ type: "question", ownKey: Boolean(override) }, statsDevice);
    return res.status(200).json({ answer, model, demo: false, ...(usage && { usage }) } satisfies AskResponse);
  } catch (error) {
    if (installId) await Promise.all([releaseAsk(installId), releaseServerCall()]).catch(() => undefined);
    if (planUser) await Promise.all([releasePlanAsk(planUser), releaseServerCall()]).catch(() => undefined);
    if (abort.signal.aborted) return;
    await track({ type: "error", route: "ask", code: error instanceof AnalysisError ? error.code : "upstream_error" }, statsDevice);
    if (error instanceof AnalysisError) {
      if (!override && error.code === "invalid_key") return sendError(res, 503, "unavailable", "The AI service is not configured correctly.");
      if (error.status >= 500) {
        console.error(`[ask:${override ? `user-${override.provider}` : activeProvider}]`, error.message);
        if (!override) await reportError(error, { route: "ask", engine: activeProvider, code: error.code });
      }
      return sendError(res, error.status, error.code, error.message);
    }
    console.error("[ask] unexpected", error instanceof Error ? error.message : error);
    await reportError(error, { route: "ask", kind: "unexpected" });
    return sendError(res, 500, "upstream_error", "Something went wrong.");
  }
}
