import type { IncomingHttpHeaders } from "node:http";
import { analyzeWithClaude, CLAUDE_MODEL, listClaudeModels, verifyClaudeKey, type EngineOptions } from "./claude";
import { analyzeWithGemini, GEMINI_MODEL, listGeminiModels, verifyGeminiKey } from "./gemini";
import { analyzeWithOpenAICompatible, listOpenAICompatibleModels, verifyOpenAICompatibleKey } from "./openaiCompatible";
import {
  AiOverrideSchema,
  overrideHeaders,
  type AiOverride,
  type AiProvider,
  type Analysis,
  type AnalyzeRequest,
  type ListModelsRequest,
} from "./schema";

type Engine = (input: AnalyzeRequest, signal?: AbortSignal, options?: EngineOptions) => Promise<{ analysis: Analysis; model: string }>;

const serverEngines: Record<Exclude<AiProvider, "demo">, { analyze: Engine; model: string; configured: boolean }> = {
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
  if (forced === "claude" || forced === "gemini") return serverEngines[forced].configured ? forced : "demo";
  if (serverEngines.claude.configured) return "claude";
  if (serverEngines.gemini.configured) return "gemini";
  return "demo";
}

export const activeProvider = resolveProvider();

export const activeModel = activeProvider === "demo" ? "demo" : serverEngines[activeProvider].model;

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
    apiKey: get(overrideHeaders.apiKey),
    model: get(overrideHeaders.model),
    baseUrl: get(overrideHeaders.baseUrl),
  });
  return parsed.success ? parsed.data : "invalid";
}

/** Analyses with the user's own key when given, else with the server's engine. */
export function analyzeImage(input: AnalyzeRequest, signal?: AbortSignal, override?: AiOverride | null) {
  if (override) {
    switch (override.provider) {
      case "claude":
        return analyzeWithClaude(input, signal, override);
      case "gemini":
        return analyzeWithGemini(input, signal, override);
      case "openai":
        return analyzeWithOpenAICompatible(input, signal, override);
    }
  }
  if (activeProvider === "demo") throw new Error("analyzeImage called in demo mode.");
  return serverEngines[activeProvider].analyze(input, signal);
}

export function verifyKey(override: AiOverride) {
  switch (override.provider) {
    case "claude":
      return verifyClaudeKey(override.apiKey, override.model);
    case "gemini":
      return verifyGeminiKey(override.apiKey, override.model);
    case "openai":
      return verifyOpenAICompatibleKey(override);
  }
}

export async function listModels(request: ListModelsRequest) {
  const models =
    request.provider === "claude"
      ? await listClaudeModels(request.apiKey)
      : request.provider === "gemini"
        ? await listGeminiModels(request.apiKey)
        : await listOpenAICompatibleModels(request.apiKey, request.baseUrl);
  return [...new Set(models)].sort((a, b) => a.localeCompare(b));
}
