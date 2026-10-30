import type { IncomingHttpHeaders } from "node:http";
import { analyzeWithClaude, askWithClaude, CLAUDE_MODEL, diagnosePlantWithClaude, listClaudeModels, readLoanWithClaude, readStatementWithClaude, summarizeWithClaude, verifyClaudeKey, writeAdWithClaude, type AiUsage, type EngineOptions } from "./claude";
import { analyzeWithGemini, askWithGemini, diagnosePlantWithGemini, GEMINI_DEEP_MODEL, GEMINI_MODEL, listGeminiModels, readLoanWithGemini, readStatementWithGemini, summarizeWithGemini, verifyGeminiKey, writeAdWithGemini } from "./gemini";
import { analyzeWithOpenAICompatible, askWithOpenAICompatible, listOpenAICompatibleModels, verifyOpenAICompatibleKey } from "./openaiCompatible";
import {
  AiOverrideSchema,
  overrideHeaders,
  type AiOverride,
  type AiProvider,
  type Analysis,
  type AnalyzeRequest,
  type AskRequest,
  type ExpenseSummaryRequest,
  type ListModelsRequest,
  type PlantDiagnosisRequest,
  type LoanScanRequest,
  type ObjectAdRequest,
  type StatementRequest,
} from "./schema";

type Engine = (input: AnalyzeRequest, signal?: AbortSignal, options?: EngineOptions) => Promise<{ analysis: Analysis; model: string; usage?: AiUsage }>;

const serverEngines: Record<Exclude<AiProvider, "demo">, { analyze: Engine; model: string; deepModel: string; configured: boolean }> = {
  claude: {
    analyze: analyzeWithClaude,
    model: CLAUDE_MODEL,
    deepModel: process.env.ANTHROPIC_DEEP_MODEL ?? CLAUDE_MODEL,
    configured: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
  },
  gemini: {
    analyze: analyzeWithGemini,
    model: GEMINI_MODEL,
    deepModel: GEMINI_DEEP_MODEL,
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
/** Analyses with the user's own key when given, else the server's engine (its bigger model for a deep analysis). */
export function analyzeImage(input: AnalyzeRequest, signal?: AbortSignal, override?: AiOverride | null, deep = false) {
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
  const engine = serverEngines[activeProvider];
  return deep ? engine.analyze(input, signal, { model: engine.deepModel, deep: true }) : engine.analyze(input, signal);
}

/** Answers a follow-up question with the user's own key when given, else the server's engine. */
export function askQuestion(input: AskRequest, signal?: AbortSignal, override?: AiOverride | null) {
  if (override) {
    switch (override.provider) {
      case "claude":
        return askWithClaude(input, signal, override);
      case "gemini":
        return askWithGemini(input, signal, override);
      case "openai":
        return askWithOpenAICompatible(input, signal, override);
    }
  }
  if (activeProvider === "claude") return askWithClaude(input, signal);
  if (activeProvider === "gemini") return askWithGemini(input, signal);
  throw new Error("askQuestion called in demo mode.");
}

/** "Mes dépenses": the month's review, always on the server's engine (never an own key). */
export function summarizeExpenses(input: ExpenseSummaryRequest, signal?: AbortSignal) {
  if (activeProvider === "claude") return summarizeWithClaude(input, signal);
  if (activeProvider === "gemini") return summarizeWithGemini(input, signal);
  throw new Error("summarizeExpenses called in demo mode.");
}

/** "Mes dépenses": a statement's operations, always on the server's engine (never an own key). */
export function readStatement(input: StatementRequest, signal?: AbortSignal) {
  if (activeProvider === "claude") return readStatementWithClaude(input, signal);
  if (activeProvider === "gemini") return readStatementWithGemini(input, signal);
  throw new Error("readStatement called in demo mode.");
}

/** "Mes plantes": a plant's problem from its photo, always on the server's engine (never an own key). */
export function diagnosePlant(input: PlantDiagnosisRequest, signal?: AbortSignal) {
  if (activeProvider === "claude") return diagnosePlantWithClaude(input, signal);
  if (activeProvider === "gemini") return diagnosePlantWithGemini(input, signal);
  throw new Error("diagnosePlant called in demo mode.");
}

/** "Prêts": a debt acknowledgment read, always on the server's engine (never an own key). */
export function readLoanDocument(input: LoanScanRequest, signal?: AbortSignal) {
  if (activeProvider === "claude") return readLoanWithClaude(input, signal);
  if (activeProvider === "gemini") return readLoanWithGemini(input, signal);
  throw new Error("readLoanDocument called in demo mode.");
}

/** Selling an object: the classified ad, always on the server's engine (never an own key). */
export function writeObjectAd(input: ObjectAdRequest & { analysis: Analysis }, signal?: AbortSignal) {
  if (activeProvider === "claude") return writeAdWithClaude(input, signal);
  if (activeProvider === "gemini") return writeAdWithGemini(input, signal);
  throw new Error("writeObjectAd called in demo mode.");
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
