import type { IncomingHttpHeaders } from "node:http";
import { analyzeWithClaude, CLAUDE_MODEL, verifyClaudeKey, type EngineOptions } from "./claude";
import { analyzeWithGemini, GEMINI_MODEL, verifyGeminiKey } from "./gemini";
import { AiOverrideSchema, overrideHeaders, type AiOverride, type AiProvider, type Analysis, type AnalyzeRequest } from "./schema";

type Engine = (input: AnalyzeRequest, signal?: AbortSignal, options?: EngineOptions) => Promise<{ analysis: Analysis; model: string }>;

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

/**
 * Reads a user-supplied key from the request headers.
 * Returns null when none was sent, or "invalid" when the headers are malformed.
 */
export function readOverride(headers: IncomingHttpHeaders): AiOverride | null | "invalid" {
  const get = (name: string) => {
    const value = headers[name];
    return Array.isArray(value) ? value[0] : value;
  };
  const provider = get(overrideHeaders.provider);
  if (!provider) return null;
  const parsed = AiOverrideSchema.safeParse({
    provider,
    apiKey: get(overrideHeaders.apiKey)?.trim(),
    model: get(overrideHeaders.model),
  });
  return parsed.success ? parsed.data : "invalid";
}

/** Analyses with the user's own key when given, else with the server's engine. */
export function analyzeImage(input: AnalyzeRequest, signal?: AbortSignal, override?: AiOverride | null) {
  if (override) {
    return engines[override.provider].analyze(input, signal, { apiKey: override.apiKey, model: override.model });
  }
  if (activeProvider === "demo") throw new Error("analyzeImage called in demo mode.");
  return engines[activeProvider].analyze(input, signal);
}

export function verifyKey({ provider, apiKey, model }: AiOverride) {
  return provider === "claude" ? verifyClaudeKey(apiKey, model) : verifyGeminiKey(apiKey, model);
}
