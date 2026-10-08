import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AnalysisError } from "./errors";
import { ASK_SYSTEM_PROMPT, buildAskContext, buildUserPrompt, SYSTEM_PROMPT } from "./prompt";
import { AnalysisSchema, type Analysis, type AnalyzeRequest, type AskRequest } from "./schema";

export const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";

const effort = (["low", "medium", "high"] as const).find((level) => level === process.env.AI_EFFORT) ?? "medium";

// Users can name any Claude model, so only send what that model accepts:
// `effort` exists on Opus 4.5+, Sonnet 4.6+ and Fable/Mythos; server-side
// fallbacks ("default" form) on the Opus 5, Fable 5, Mythos 5 and Sonnet 5.5 lines.
const supportsEffort = (model: string) => /^claude-(opus-(4-[5-9]|5)|sonnet-(4-6|5)|fable|mythos)/.test(model);
const supportsFallbacks = (model: string) => /^claude-(opus-5|fable-5|mythos-5|sonnet-5-5)/.test(model);

/** Tokens an AI call used (to know what the server's key costs). */
export type AiUsage = { inputTokens: number; outputTokens: number };

export type EngineOptions = {
  /** A key supplied by the user for this request only. */
  apiKey?: string;
  model?: string;
  /** A deep analysis: a bigger model, given more time. */
  deep?: boolean;
  /** OpenAI-compatible APIs only. */
  baseUrl?: string;
};

let serverClient: Anthropic | null = null;
function getClient(apiKey?: string) {
  if (apiKey) return new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });
  serverClient ??= new Anthropic({ timeout: 60_000, maxRetries: 1 });
  return serverClient;
}

export async function analyzeWithClaude(
  input: AnalyzeRequest,
  signal?: AbortSignal,
  options: EngineOptions = {},
): Promise<{ analysis: Analysis; model: string; usage?: AiUsage }> {
  const model = options.model ?? CLAUDE_MODEL;
  let response;
  try {
    response = await getClient(options.apiKey).beta.messages.parse(
      {
        model,
        max_tokens: 16000,
        // On a safety decline, let the API re-run the request on its recommended
        // fallback model instead of returning a refusal straight away.
        ...(supportsFallbacks(model) && { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
        output_config: {
          ...(supportsEffort(model) && { effort }),
          format: betaZodOutputFormat(AnalysisSchema),
        },
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: input.mediaType, data: input.image },
              },
              { type: "text", text: buildUserPrompt(input.mode, input.locale) },
            ],
          },
        ],
      },
      { signal },
    );
  } catch (error) {
    throw toAnalysisError(error, model);
  }

  if (response.stop_reason === "refusal") {
    throw new AnalysisError("refused", 422, response.stop_details?.explanation ?? "The model declined this image.");
  }
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new AnalysisError("upstream_error", 502, `Unusable model output (stop_reason: ${response.stop_reason}).`);
  }

  return { analysis: response.parsed_output, model: response.model, usage: claudeUsage(response.usage) };
}

/** Cheapest call that proves a key works and its account has credit. */
export async function verifyClaudeKey(apiKey: string, model: string) {
  try {
    await getClient(apiKey).messages.create({
      model,
      max_tokens: 64,
      ...(supportsEffort(model) && { output_config: { effort: "low" as const } }),
      messages: [{ role: "user", content: "Reply with OK." }],
    });
  } catch (error) {
    throw toAnalysisError(error, model);
  }
}

/** Answers a follow-up question about a scan; the photo goes with the first question. */
export async function askWithClaude(
  input: AskRequest,
  signal?: AbortSignal,
  options: EngineOptions = {},
): Promise<{ answer: string; model: string; usage?: AiUsage }> {
  const model = options.model ?? CLAUDE_MODEL;
  const messages: Anthropic.Beta.BetaMessageParam[] = input.messages.map((message, index) =>
    index === 0
      ? {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: input.mediaType, data: input.image } },
            { type: "text", text: buildAskContext(input.analysis, input.locale) + message.content },
          ],
        }
      : { role: message.role, content: message.content },
  );

  let response;
  try {
    response = await getClient(options.apiKey).beta.messages.create(
      {
        model,
        max_tokens: 4000,
        ...(supportsFallbacks(model) && { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
        // Conversation replies favour speed over depth.
        ...(supportsEffort(model) && { output_config: { effort: "low" as const } }),
        system: [{ type: "text", text: ASK_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages,
      },
      { signal },
    );
  } catch (error) {
    throw toAnalysisError(error, model);
  }

  if (response.stop_reason === "refusal") {
    throw new AnalysisError("refused", 422, response.stop_details?.explanation ?? "The model declined this question.");
  }
  const answer = response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
  if (!answer) throw new AnalysisError("upstream_error", 502, `Empty answer (stop_reason: ${response.stop_reason}).`);
  return { answer, model: response.model, usage: claudeUsage(response.usage) };
}

export async function listClaudeModels(apiKey: string) {
  try {
    const ids: string[] = [];
    for await (const model of getClient(apiKey).models.list({ limit: 100 })) ids.push(model.id);
    return ids;
  } catch (error) {
    throw toAnalysisError(error, "");
  }
}

function toAnalysisError(error: unknown, model: string): unknown {
  // The API reports an empty balance as a 400; surface it instead of blaming the image.
  if (error instanceof Anthropic.BadRequestError && /credit balance/i.test(error.message)) {
    return new AnalysisError("billing", 402, "The Anthropic account has no credit left.");
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AnalysisError("rate_limited", 429, "Claude is busy, try again in a moment.");
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new AnalysisError("unavailable", 404, `The model ${model} isn't available for this key.`);
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new AnalysisError("invalid_request", 400, error.message);
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new AnalysisError("invalid_key", 401, "Claude rejected this API key.");
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AnalysisError("unavailable", 503, "Claude can't be reached right now.");
  }
  if (error instanceof Anthropic.APIError) {
    return new AnalysisError("upstream_error", 502, `Claude API error ${error.status}: ${error.message}`);
  }
  return error;
}

/** Cached prompt tokens count as input (an upper bound: they cost less). */
function claudeUsage(usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null }): AiUsage {
  return {
    inputTokens: usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
    outputTokens: usage.output_tokens,
  };
}
