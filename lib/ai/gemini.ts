import { ApiError, createPartFromBase64, FinishReason, GoogleGenAI, ThinkingLevel } from "@google/genai";
import { z } from "zod";
import type { AiUsage, EngineOptions } from "./claude";
import { AnalysisError } from "./errors";
import { ASK_SYSTEM_PROMPT, buildAskContext, buildUserPrompt, SYSTEM_PROMPT } from "./prompt";
import { AnalysisSchema, type Analysis, type AnalyzeRequest, type AskRequest } from "./schema";

// Free-tier friendly alternative to Claude (Google AI Studio key, no billing).
// The "-latest" aliases always point at the current Flash models.
export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-flash-latest";
/** Deep analyses (Premium): the current Pro model. */
export const GEMINI_DEEP_MODEL = process.env.GEMINI_DEEP_MODEL ?? "gemini-pro-latest";

// Free-tier capacity is shared: when a model is overloaded, fall through to
// the next one instead of failing the analysis.
const FALLBACK_MODEL = "gemini-flash-lite-latest";
const FALLBACK_STATUSES = new Set([404, 429, 500, 503, 504]);
// A saturated model can hang for minutes before failing: give each attempt
// this long, then move on to the next model in the chain.
const ATTEMPT_TIMEOUT_MS = 30_000;
// A Pro model thinks longer; the route allows 60 s in all.
const DEEP_TIMEOUT_MS = 55_000;

/** Overloaded, rate-limited, missing or stuck: worth trying the next model. */
function canFallBack(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return false;
  if (error instanceof ApiError) return FALLBACK_STATUSES.has(error.status);
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  return /timeout|abort/i.test(name) || /timed? ?out|aborted/i.test(message);
}

// Gemini accepts a subset of JSON Schema; the draft URI is not part of it.
const responseJsonSchema = { ...z.toJSONSchema(AnalysisSchema), $schema: undefined };

const blockedReasons = new Set<FinishReason | undefined>([
  FinishReason.SAFETY,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
  FinishReason.IMAGE_SAFETY,
  FinishReason.IMAGE_PROHIBITED_CONTENT,
]);

// No SDK retries (default 5 with backoff, ~45 s when overloaded): the model
// chain below is a faster way to recover.
const httpOptions = { retryOptions: { attempts: 1 } };

let serverClient: GoogleGenAI | null = null;
function getClient(apiKey?: string) {
  if (apiKey) return new GoogleGenAI({ apiKey, httpOptions });
  serverClient ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions });
  return serverClient;
}

export async function analyzeWithGemini(
  input: AnalyzeRequest,
  signal?: AbortSignal,
  options: EngineOptions = {},
): Promise<{ analysis: Analysis; model: string; usage?: AiUsage }> {
  const client = getClient(options.apiKey);
  // Only fall back to Flash-Lite from the default model: a model the user
  // picked by name is what they asked for.
  const model = options.model ?? GEMINI_MODEL;
  const chain = model === GEMINI_MODEL ? [...new Set([model, FALLBACK_MODEL])] : [model];
  let lastError: unknown;
  for (const candidate of chain) {
    try {
      return await analyzeOnce(client, candidate, input, signal, options.deep ? DEEP_TIMEOUT_MS : ATTEMPT_TIMEOUT_MS);
    } catch (error) {
      lastError = error;
      const retryable = canFallBack(error, signal);
      if (!retryable || signal?.aborted) break;
      console.warn(`[gemini] ${candidate} unavailable (${error instanceof ApiError ? error.status : "timeout"}), trying next model`);
    }
  }
  throw toAnalysisError(lastError);
}

async function analyzeOnce(
  client: GoogleGenAI,
  model: string,
  input: AnalyzeRequest,
  signal?: AbortSignal,
  timeoutMs = ATTEMPT_TIMEOUT_MS,
): Promise<{ analysis: Analysis; model: string; usage?: AiUsage }> {
  const response = await client.models.generateContent({
    model,
    contents: [createPartFromBase64(input.image, input.mediaType), buildUserPrompt(input.mode, input.locale)],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseJsonSchema,
      abortSignal: signal,
      httpOptions: { timeout: timeoutMs },
    },
  });

  const candidate = response.candidates?.[0];
  if (response.promptFeedback?.blockReason || blockedReasons.has(candidate?.finishReason)) {
    throw new AnalysisError("refused", 422, `Gemini blocked this image (${response.promptFeedback?.blockReason ?? candidate?.finishReason}).`);
  }

  const parsed = AnalysisSchema.safeParse(safeJson(response.text));
  if (!parsed.success) {
    throw new AnalysisError("upstream_error", 502, `Unusable Gemini output (finishReason: ${candidate?.finishReason}).`);
  }

  return { analysis: parsed.data, model: response.modelVersion ?? model, usage: geminiUsage(response.usageMetadata) };
}

function safeJson(text: string | undefined) {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

/** Answers a follow-up question about a scan; the photo goes with the first question. */
export async function askWithGemini(
  input: AskRequest,
  signal?: AbortSignal,
  options: EngineOptions = {},
): Promise<{ answer: string; model: string; usage?: AiUsage }> {
  const client = getClient(options.apiKey);
  const model = options.model ?? GEMINI_MODEL;
  // Replies start on Flash-Lite (about 1 s) and only use Flash if it fails.
  const chain = model === GEMINI_MODEL ? [...new Set([FALLBACK_MODEL, model])] : [model];
  const contents = input.messages.map((message, index) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts:
      index === 0
        ? [createPartFromBase64(input.image, input.mediaType), { text: buildAskContext(input.analysis, input.locale) + message.content }]
        : [{ text: message.content }],
  }));

  let lastError: unknown;
  for (const candidate of chain) {
    try {
      const response = await client.models.generateContent({
        model: candidate,
        contents,
        // Chat replies favour speed: low thinking cuts answers from ~15 s to a few seconds.
        config: {
          systemInstruction: ASK_SYSTEM_PROMPT,
          abortSignal: signal,
          httpOptions: { timeout: ATTEMPT_TIMEOUT_MS },
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });
      const finish = response.candidates?.[0]?.finishReason;
      if (response.promptFeedback?.blockReason || blockedReasons.has(finish)) {
        throw new AnalysisError("refused", 422, "Gemini blocked this question.");
      }
      const answer = response.text?.trim();
      if (!answer) throw new AnalysisError("upstream_error", 502, `Empty Gemini answer (finishReason: ${finish}).`);
      return { answer, model: response.modelVersion ?? candidate, usage: geminiUsage(response.usageMetadata) };
    } catch (error) {
      lastError = error;
      const retryable = canFallBack(error, signal);
      if (!retryable || signal?.aborted) break;
    }
  }
  throw toAnalysisError(lastError);
}

/**
 * Proves the key works and the model exists, by reading the model's metadata.
 * Unlike a test generation, it doesn't fail when the model is overloaded.
 */
export async function verifyGeminiKey(apiKey: string, model: string) {
  let info;
  try {
    info = await getClient(apiKey).models.get({ model });
  } catch (error) {
    throw toAnalysisError(error);
  }
  if (info.supportedActions && !info.supportedActions.includes("generateContent")) {
    throw new AnalysisError("unavailable", 404, `${model} can't analyse images.`);
  }
}

export async function listGeminiModels(apiKey: string) {
  try {
    const ids: string[] = [];
    for await (const model of await getClient(apiKey).models.list({ config: { pageSize: 100 } })) {
      if (model.name && (model.supportedActions ?? []).includes("generateContent")) ids.push(model.name.replace(/^models\//, ""));
    }
    return ids;
  } catch (error) {
    throw toAnalysisError(error);
  }
}

function toAnalysisError(error: unknown): unknown {
  if (!(error instanceof ApiError)) return error;
  if (error.status === 429) {
    return new AnalysisError("rate_limited", 429, "Gemini free-tier quota reached, try again in a moment.");
  }
  if (error.status === 400 && /api key/i.test(error.message)) {
    return new AnalysisError("invalid_key", 401, "Gemini rejected this API key.");
  }
  if (error.status === 400) {
    return new AnalysisError("invalid_request", 400, error.message);
  }
  if (error.status === 503 || error.status === 504) {
    return new AnalysisError("unavailable", 503, "Gemini is overloaded right now, try again in a moment.");
  }
  if (error.status === 401 || error.status === 403) {
    return new AnalysisError("invalid_key", 401, "Gemini rejected the credentials.");
  }
  if (error.status === 404) {
    return new AnalysisError("unavailable", 404, "This Gemini model isn't available for this key.");
  }
  return new AnalysisError("upstream_error", 502, `Gemini API error ${error.status}: ${error.message}`);
}

/** Thinking tokens are billed as output. */
function geminiUsage(metadata: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } | undefined): AiUsage {
  return {
    inputTokens: metadata?.promptTokenCount ?? 0,
    outputTokens: (metadata?.candidatesTokenCount ?? 0) + (metadata?.thoughtsTokenCount ?? 0),
  };
}
