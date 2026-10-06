import { ApiError, createPartFromBase64, FinishReason, GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { EngineOptions } from "./claude";
import { AnalysisError } from "./errors";
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt";
import { AnalysisSchema, type Analysis, type AnalyzeRequest } from "./schema";

// Free-tier friendly alternative to Claude (Google AI Studio key, no billing).
// The "-latest" aliases always point at the current Flash models.
export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-flash-latest";

// Free-tier capacity is shared: when a model is overloaded, fall through to
// the next one instead of failing the analysis.
const FALLBACK_MODEL = "gemini-flash-lite-latest";
const FALLBACK_STATUSES = new Set([404, 429, 500, 503]);

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
): Promise<{ analysis: Analysis; model: string }> {
  const client = getClient(options.apiKey);
  // Only fall back to Flash-Lite from the default model: a model the user
  // picked by name is what they asked for.
  const model = options.model ?? GEMINI_MODEL;
  const chain = model === GEMINI_MODEL ? [...new Set([model, FALLBACK_MODEL])] : [model];
  let lastError: unknown;
  for (const candidate of chain) {
    try {
      return await analyzeOnce(client, candidate, input, signal);
    } catch (error) {
      lastError = error;
      const retryable = error instanceof ApiError && FALLBACK_STATUSES.has(error.status);
      if (!retryable || signal?.aborted) break;
      console.warn(`[gemini] ${candidate} unavailable (${(error as ApiError).status}), trying next model`);
    }
  }
  throw toAnalysisError(lastError);
}

async function analyzeOnce(
  client: GoogleGenAI,
  model: string,
  input: AnalyzeRequest,
  signal?: AbortSignal,
): Promise<{ analysis: Analysis; model: string }> {
  const response = await client.models.generateContent({
    model,
    contents: [createPartFromBase64(input.image, input.mediaType), buildUserPrompt(input.mode, input.locale)],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseJsonSchema,
      abortSignal: signal,
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

  return { analysis: parsed.data, model: response.modelVersion ?? model };
}

function safeJson(text: string | undefined) {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

/** Cheapest call that proves a key works for this model. */
export async function verifyGeminiKey(apiKey: string, model: string) {
  try {
    await getClient(apiKey).models.generateContent({ model, contents: "Reply with OK." });
  } catch (error) {
    throw toAnalysisError(error);
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
  if (error.status === 503) {
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
