import type { AiUsage } from "./claude";
import { z } from "zod";
import { assertPublicHttpsUrl, UnsafeUrlError } from "@/lib/server/safeUrl";
import { AnalysisError } from "./errors";
import { ASK_SYSTEM_PROMPT, buildAskContext, buildUserPrompt, SYSTEM_PROMPT } from "./prompt";
import { AnalysisSchema, type Analysis, type AnalyzeRequest, type AskRequest } from "./schema";

// Any provider that speaks the OpenAI chat completions API: OpenAI, Mistral,
// Groq, OpenRouter, xAI, Together, self-hosted servers… Not every one supports
// strict JSON schemas, so the response format degrades step by step and the
// result is always validated with the shared Zod schema.

const jsonSchema = { ...z.toJSONSchema(AnalysisSchema), $schema: undefined };
const TIMEOUT_MS = 60_000;

type Options = { apiKey: string; model: string; baseUrl: string };

type ResponseFormat = "json_schema" | "json_object" | "none";
const formats: ResponseFormat[] = ["json_schema", "json_object", "none"];

const jsonInstructions = `\n\nReturn only a JSON object, with no other text, that matches this JSON Schema:\n${JSON.stringify(jsonSchema)}`;

function responseFormat(format: ResponseFormat) {
  if (format === "json_schema") {
    return { type: "json_schema", json_schema: { name: "analysis", strict: true, schema: jsonSchema } };
  }
  if (format === "json_object") return { type: "json_object" };
  return undefined;
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function post(baseUrl: string, path: string, apiKey: string, body: unknown, signal?: AbortSignal) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    // Redirects could lead to an internal address the URL check never saw.
    redirect: "error",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) throw new HttpError(response.status, extractErrorMessage(text));
  try {
    return JSON.parse(text) as { choices?: { message?: { content?: unknown; refusal?: string | null } }[] };
  } catch {
    throw new HttpError(502, "The API returned something that isn't JSON.");
  }
}

function extractErrorMessage(text: string) {
  try {
    const body = JSON.parse(text);
    const message = body?.error?.message ?? body?.message ?? body?.detail ?? text;
    return String(typeof message === "string" ? message : JSON.stringify(message)).slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}

/** Pulls the JSON object out of a reply that may be wrapped in prose or ``` fences. */
function parseJsonContent(content: unknown) {
  const text = Array.isArray(content)
    ? content.map((part) => (typeof part === "object" && part && "text" in part ? String(part.text) : "")).join("")
    : String(content ?? "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

// A 400 that complains about response_format means "try a simpler format".
const isFormatRejection = (error: unknown) =>
  error instanceof HttpError && error.status === 400 && /response_format|json_schema|json_object|schema|structured/i.test(error.message);

export async function analyzeWithOpenAICompatible(
  input: AnalyzeRequest,
  signal: AbortSignal | undefined,
  { apiKey, model, baseUrl }: Options,
): Promise<{ analysis: Analysis; model: string; usage?: AiUsage }> {
  await checkUrl(baseUrl);
  const image = `data:${input.mediaType};base64,${input.image}`;

  for (const format of formats) {
    try {
      const body = await post(
        baseUrl,
        "/chat/completions",
        apiKey,
        {
          model,
          messages: [
            { role: "system", content: format === "json_schema" ? SYSTEM_PROMPT : SYSTEM_PROMPT + jsonInstructions },
            {
              role: "user",
              content: [
                { type: "text", text: buildUserPrompt(input.mode, input.locale) },
                { type: "image_url", image_url: { url: image } },
              ],
            },
          ],
          ...(responseFormat(format) && { response_format: responseFormat(format) }),
        },
        signal,
      );

      const message = body.choices?.[0]?.message;
      if (message?.refusal) throw new AnalysisError("refused", 422, message.refusal);
      const parsed = AnalysisSchema.safeParse(parseJsonContent(message?.content));
      if (!parsed.success) {
        throw new AnalysisError("upstream_error", 502, "The model's answer didn't match the expected format.");
      }
      return { analysis: parsed.data, model };
    } catch (error) {
      if (isFormatRejection(error) && format !== "none") continue;
      throw toAnalysisError(error, model);
    }
  }
  throw new AnalysisError("upstream_error", 502, "No response format worked with this API.");
}

/** Answers a follow-up question about a scan; the photo goes with the first question. */
export async function askWithOpenAICompatible(
  input: AskRequest,
  signal: AbortSignal | undefined,
  { apiKey, model, baseUrl }: Options,
): Promise<{ answer: string; model: string; usage?: AiUsage }> {
  await checkUrl(baseUrl);
  const image = `data:${input.mediaType};base64,${input.image}`;
  const messages = [
    { role: "system", content: ASK_SYSTEM_PROMPT },
    ...input.messages.map((message, index) =>
      index === 0
        ? {
            role: "user",
            content: [
              { type: "text", text: buildAskContext(input.analysis, input.locale) + message.content },
              { type: "image_url", image_url: { url: image } },
            ],
          }
        : { role: message.role, content: message.content },
    ),
  ];
  try {
    const body = await post(baseUrl, "/chat/completions", apiKey, { model, messages }, signal);
    const message = body.choices?.[0]?.message;
    if (message?.refusal) throw new AnalysisError("refused", 422, message.refusal);
    const content = message?.content;
    const answer = (Array.isArray(content)
      ? content.map((part) => (typeof part === "object" && part && "text" in part ? String(part.text) : "")).join("")
      : String(content ?? "")
    ).trim();
    if (!answer) throw new AnalysisError("upstream_error", 502, "The API returned an empty answer.");
    return { answer, model };
  } catch (error) {
    throw toAnalysisError(error, model);
  }
}

/** Cheapest call that proves the key, the model and the account work. */
export async function verifyOpenAICompatibleKey({ apiKey, model, baseUrl }: Options) {
  await checkUrl(baseUrl);
  try {
    await post(baseUrl, "/chat/completions", apiKey, { model, messages: [{ role: "user", content: "Reply with OK." }] });
  } catch (error) {
    throw toAnalysisError(error, model);
  }
}

export async function listOpenAICompatibleModels(apiKey: string, baseUrl: string) {
  await checkUrl(baseUrl);
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    if (!response.ok) throw new HttpError(response.status, extractErrorMessage(text));
    const body = JSON.parse(text) as { data?: { id?: unknown }[] };
    return (body.data ?? []).map((item) => String(item.id ?? "")).filter(Boolean);
  } catch (error) {
    throw toAnalysisError(error, "");
  }
}

async function checkUrl(baseUrl: string) {
  try {
    await assertPublicHttpsUrl(baseUrl);
  } catch (error) {
    if (error instanceof UnsafeUrlError) throw new AnalysisError("invalid_request", 400, error.message);
    throw error;
  }
}

function toAnalysisError(error: unknown, model: string): unknown {
  if (error instanceof AnalysisError) return error;
  if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return new AnalysisError("unavailable", 504, "The API took too long to answer.");
  }
  if (!(error instanceof HttpError)) {
    return new AnalysisError("unavailable", 503, "This API can't be reached. Check its address.");
  }
  const { status, message } = error;
  if (status === 401 || status === 403) return new AnalysisError("invalid_key", 401, "The API rejected this key.");
  if (status === 402 || /insufficient_quota|billing|credit|payment/i.test(message)) {
    return new AnalysisError("billing", 402, "The account behind this key has no credit.");
  }
  if (status === 429) return new AnalysisError("rate_limited", 429, "This API's rate limit is reached, try again later.");
  if (status === 502 || status === 503 || status === 504) {
    return new AnalysisError("unavailable", 503, "This API is overloaded right now, try again in a moment.");
  }
  if (status === 404) return new AnalysisError("unavailable", 404, `The model ${model} isn't available at this API.`);
  if (status === 400 && /image|vision|multimodal|image_url/i.test(message)) {
    return new AnalysisError("invalid_request", 400, `The model ${model} doesn't accept images. Pick a vision model.`);
  }
  if (status === 400) return new AnalysisError("invalid_request", 400, message);
  return new AnalysisError("upstream_error", 502, `API error ${status}: ${message}`);
}
