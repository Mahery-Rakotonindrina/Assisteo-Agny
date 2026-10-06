import { analyzeWithClaude, CLAUDE_MODEL } from "./claude";
import { analyzeWithGemini, GEMINI_MODEL } from "./gemini";
import type { AiProvider, Analysis, AnalyzeRequest } from "./schema";

type Engine = (input: AnalyzeRequest, signal?: AbortSignal) => Promise<{ analysis: Analysis; model: string }>;

const engines: Record<Exclude<AiProvider, "demo">, { analyze: Engine; model: string; configured: boolean }> = {
  claude: {
    analyze: analyzeWithClaude,
    model: CLAUDE_MODEL,
    configured: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
  },
  gemini: {
    analyze: analyzeWithGemini,
    model: GEMINI_MODEL,
    configured: Boolean(process.env.GEMINI_API_KEY),
  },
};

/**
 * AI_PROVIDER forces an engine; otherwise the first configured one wins
 * (Claude, then Gemini). With no key at all the app runs on demo samples.
 */
function resolveProvider(): AiProvider {
  if (process.env.AI_DEMO_MODE === "true") return "demo";
  const forced = process.env.AI_PROVIDER;
  if (forced === "claude" || forced === "gemini") return engines[forced].configured ? forced : "demo";
  if (engines.claude.configured) return "claude";
  if (engines.gemini.configured) return "gemini";
  return "demo";
}

export const activeProvider = resolveProvider();

export const activeModel = activeProvider === "demo" ? "demo" : engines[activeProvider].model;

export function analyzeImage(input: AnalyzeRequest, signal?: AbortSignal) {
  if (activeProvider === "demo") throw new Error("analyzeImage called in demo mode.");
  return engines[activeProvider].analyze(input, signal);
}
