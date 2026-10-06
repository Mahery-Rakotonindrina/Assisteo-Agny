import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AnalysisError } from "./errors";
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt";
import { AnalysisSchema, type Analysis, type AnalyzeRequest } from "./schema";

export const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";

const effort = (["low", "medium", "high"] as const).find((level) => level === process.env.AI_EFFORT) ?? "medium";

// Haiku 4.5 rejects `effort` and server-side fallbacks; the 5.x models take both.
const supportsEffortAndFallbacks = (model: string) => !model.startsWith("claude-haiku-4-5");

export type EngineOptions = {
  /** A key supplied by the user for this request only. */
  apiKey?: string;
  model?: string;
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
): Promise<{ analysis: Analysis; model: string }> {
  const model = options.model ?? CLAUDE_MODEL;
  const advanced = supportsEffortAndFallbacks(model);
  let response;
  try {
    response = await getClient(options.apiKey).beta.messages.parse(
      {
        model,
        max_tokens: 16000,
        // On a safety decline, let the API re-run the request on its recommended
        // fallback model instead of returning a refusal straight away.
        ...(advanced && { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
        output_config: {
          ...(advanced && { effort }),
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

  return { analysis: response.parsed_output, model: response.model };
}

/** Cheapest call that proves a key works and its account has credit. */
export async function verifyClaudeKey(apiKey: string, model: string) {
  try {
    await getClient(apiKey).messages.create({
      model,
      max_tokens: 64,
      ...(supportsEffortAndFallbacks(model) && { output_config: { effort: "low" as const } }),
      messages: [{ role: "user", content: "Reply with OK." }],
    });
  } catch (error) {
    throw toAnalysisError(error, model);
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
