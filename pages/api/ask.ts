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
import { releaseAsk, reserveAsk } from "@/lib/server/trialStore";

export const config = {
  api: { bodyParser: { sizeLimit: "7mb" } },
  maxDuration: 60,
};

const demoAnswers = {
  fr: "Je suis en mode démo : je ne peux pas vraiment répondre à ta question. Ajoute une clé IA (Réglages → Moteur IA) ou configure l'IA du serveur pour discuter de tes scans.",
  en: "I'm in demo mode, so I can't really answer your question. Add an AI key (Settings → AI engine) or set up the server's AI to chat about your scans.",
};

/** Answers a follow-up question about a scan, with the photo and the earlier analysis as context. */
export default async function handler(req: NextApiRequest, res: NextApiResponse<AskResponse | unknown>) {
  if (applyCors(req, res, ["POST"])) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return sendError(res, 405, "method_not_allowed", "Use POST.");
  }

  const limit = rateLimit(`ask:${clientIp(req)}`, 30, 60_000);
  if (!limit.ok) return sendError(res, 429, "rate_limited", "Too many questions, slow down a little.");

  const parsed = AskRequestSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid request.");
  const analysis = AnalysisSchema.safeParse(normalizeStoredAnalysis(parsed.data.analysis));
  if (!analysis.success) return sendError(res, 400, "invalid_request", "Invalid scan context.");

  const override = readOverride(req.headers);
  if (override === "invalid") return sendError(res, 400, "invalid_request", "Invalid AI provider, model or key.");

  if (!override && activeProvider === "demo") {
    return res.status(200).json({ answer: demoAnswers[parsed.data.locale], model: "demo", demo: true } satisfies AskResponse);
  }

  // On the server's key, questions draw on a daily allowance per install.
  let installId: string | null = null;
  if (!override) {
    const id = InstallIdSchema.safeParse(req.headers[installIdHeader]);
    if (!id.success) return sendError(res, 400, "invalid_request", "Missing install id: update the app.");
    if (!(await reserveAsk(id.data))) {
      return sendError(res, 403, "ask_limit", "Today's questions on the server's AI are used up: add your own API key to continue.");
    }
    installId = id.data;
  }

  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  try {
    const { answer, model } = await askQuestion({ ...parsed.data, analysis: analysis.data }, abort.signal, override);
    return res.status(200).json({ answer, model, demo: false } satisfies AskResponse);
  } catch (error) {
    if (installId) await releaseAsk(installId).catch(() => undefined);
    if (abort.signal.aborted) return;
    if (error instanceof AnalysisError) {
      if (!override && error.code === "invalid_key") return sendError(res, 503, "unavailable", "The AI service is not configured correctly.");
      if (error.status >= 500) console.error(`[ask:${override ? `user-${override.provider}` : activeProvider}]`, error.message);
      return sendError(res, error.status, error.code, error.message);
    }
    console.error("[ask] unexpected", error instanceof Error ? error.message : error);
    return sendError(res, 500, "upstream_error", "Something went wrong.");
  }
}
