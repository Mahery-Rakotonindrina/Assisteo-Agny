import { z } from "zod";

// Shared by the API route (structured output contract with Claude) and the
// client (response validation + types). Fields are nullable rather than
// optional so the model always emits every key.

export const scanModes = ["auto", "food", "document", "object"] as const;
export type ScanMode = (typeof scanModes)[number];

export const categories = ["food", "document", "object", "plant", "other"] as const;
export type Category = (typeof categories)[number];

export const AnalysisSchema = z.object({
  category: z.enum(categories).describe("What the photo mainly shows."),
  title: z.string().describe("Short name of the subject, 2 to 6 words."),
  summary: z.string().describe("Two or three plain sentences describing what was found."),
  confidence: z.number().describe("Confidence in the identification, from 0 to 1."),
  tags: z.array(z.string()).describe("3 to 6 lowercase keywords."),
  facts: z
    .array(z.object({ label: z.string(), value: z.string() }))
    .describe("3 to 6 key facts as short label/value pairs."),
  suggestions: z
    .array(
      z.object({
        kind: z.enum(["tip", "action", "warning", "idea"]),
        title: z.string(),
        detail: z.string(),
      }),
    )
    .describe("2 to 4 practical, specific suggestions for the user."),
  nutrition: z
    .object({
      portion: z.string().describe("The portion the estimate refers to."),
      calories: z.number(),
      proteinG: z.number(),
      carbsG: z.number(),
      fatG: z.number(),
    })
    .nullable()
    .describe("Estimated nutrition for the visible portion. Only for food, null otherwise."),
  recipe: z
    .object({
      name: z.string().describe("Recipe title."),
      servings: z.number().describe("Number of servings."),
      prepMinutes: z.number(),
      cookMinutes: z.number().describe("0 when there is no cooking."),
      difficulty: z.enum(["easy", "medium", "hard"]),
      ingredients: z
        .array(z.object({ name: z.string(), quantity: z.string().describe("Amount with unit, e.g. '200 g', '2 tbsp'.") }))
        .describe("Every ingredient, in order of use."),
      steps: z.array(z.string()).describe("4 to 8 short, actionable steps."),
      tip: z.string().nullable().describe("One chef's tip, or null."),
    })
    .nullable()
    .describe(
      "Only for food, null otherwise. For a prepared dish: how to make it at home. For a raw ingredient or product: a simple recipe that uses it.",
    ),
  document: z
    .object({
      type: z.string().describe("Kind of document, e.g. invoice, letter, receipt."),
      keyPoints: z.array(z.string()),
      dates: z.array(z.object({ label: z.string(), date: z.string() })),
      actionItems: z.array(z.string()),
    })
    .nullable()
    .describe("Only for documents, null otherwise."),
  reminder: z
    .object({
      title: z.string(),
      body: z.string(),
      delayHours: z.number().describe("Hours from now when the reminder should fire."),
    })
    .nullable()
    .describe("A useful time-based reminder (expiry, due date, follow-up), or null if none makes sense."),
});

export type Analysis = z.infer<typeof AnalysisSchema>;

export const imageMediaTypes = ["image/jpeg", "image/png", "image/webp"] as const;

// ~5 MB decoded is Claude's per-image limit; base64 inflates by 4/3.
export const MAX_IMAGE_BASE64_LENGTH = Math.floor((5 * 1024 * 1024 * 4) / 3);

export const AnalyzeRequestSchema = z.object({
  image: z.string().min(1).max(MAX_IMAGE_BASE64_LENGTH),
  mediaType: z.enum(imageMediaTypes),
  mode: z.enum(scanModes),
  locale: z.enum(["fr", "en"]),
});

export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;

export type AiProvider = "claude" | "gemini" | "demo";

// ---- Bring your own key ---------------------------------------------------
// A user can analyse with their own key for any provider. Claude and Gemini use
// their native APIs; everything else (OpenAI, Mistral, Groq, OpenRouter, xAI,
// self-hosted servers…) goes through the OpenAI-compatible chat API at a base
// URL of their choice. The key lives on the device and travels with each
// request in headers; the server uses it for that call only, never storing or
// logging it.

export const protocols = ["claude", "gemini", "openai"] as const;
export type Protocol = (typeof protocols)[number];

const ApiKeySchema = z.string().trim().min(8).max(400);
export const ModelIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[\w.:/@+-]+$/, "Invalid model name.");
export const BaseUrlSchema = z
  .string()
  .trim()
  .max(300)
  .regex(/^https:\/\/\S+$/, "The API address must start with https://.")
  .transform((url) => url.replace(/\/+$/, ""));

export const AiOverrideSchema = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("claude"), apiKey: ApiKeySchema, model: ModelIdSchema }),
  z.object({ provider: z.literal("gemini"), apiKey: ApiKeySchema, model: ModelIdSchema }),
  z.object({ provider: z.literal("openai"), apiKey: ApiKeySchema, model: ModelIdSchema, baseUrl: BaseUrlSchema }),
]);

export type AiOverride = z.infer<typeof AiOverrideSchema>;

/** Same as AiOverride without the model: what listing models needs. */
export const ListModelsRequestSchema = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("claude"), apiKey: ApiKeySchema }),
  z.object({ provider: z.literal("gemini"), apiKey: ApiKeySchema }),
  z.object({ provider: z.literal("openai"), apiKey: ApiKeySchema, baseUrl: BaseUrlSchema }),
]);

export type ListModelsRequest = z.infer<typeof ListModelsRequestSchema>;
export type ListModelsResponse = { ok: true; models: string[] } | { ok: false; reason: VerifyFailure };

export const overrideHeaders = {
  provider: "x-ai-provider",
  apiKey: "x-ai-key",
  model: "x-ai-model",
  baseUrl: "x-ai-base-url",
} as const;

export type VerifyFailure = "invalid_key" | "billing" | "rate_limited" | "overloaded" | "model_unavailable" | "bad_url" | "error";

export type VerifyKeyResponse = { ok: true; model: string } | { ok: false; reason: VerifyFailure; detail?: string };

export type HealthResponse = {
  status: "ok";
  ai: "live" | "demo";
  provider: AiProvider;
  model: string;
};

export type TrialState = { limit: number; used: number };

export type AnalyzeResponse = {
  analysis: Analysis;
  meta: {
    model: string;
    demo: boolean;
    durationMs: number;
    /** Present when the analysis used the server's key (free trial). */
    trial?: TrialState;
  };
};

// ---- Free trial ------------------------------------------------------------
// Each install has an anonymous id; the server counts trial scans against it.

export const installIdHeader = "x-install-id";
export const InstallIdSchema = z.string().regex(/^[a-zA-Z0-9-]{16,64}$/);

export type TrialResponse = TrialState & {
  /** False when the server runs in demo mode: no trial to count. */
  enabled: boolean;
};

export type ApiErrorCode =
  | "invalid_request"
  | "rate_limited"
  | "refused"
  | "upstream_error"
  | "unavailable"
  | "billing"
  | "invalid_key"
  | "trial_exhausted"
  | "method_not_allowed";

export type ApiErrorBody = {
  error: { code: ApiErrorCode; message: string };
};
