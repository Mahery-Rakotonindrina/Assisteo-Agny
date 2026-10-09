import { z } from "zod";

// No eval-based fast paths: the web CSP forbids eval, and Zod's probe for it
// would otherwise log a violation on every page.
z.config({ jitless: true });

// Shared by the API route (structured output contract with Claude) and the
// client (response validation + types). Fields are nullable rather than
// optional so the model always emits every key.

export const scanModes = ["auto", "food", "document", "vehicle", "object"] as const;
export type ScanMode = (typeof scanModes)[number];

export const categories = ["food", "document", "list", "parcel", "vehicle", "object", "plant", "other"] as const;

/** What a list is for: things to buy, things to do, or anything else. */
export const listKinds = ["shopping", "todo", "other"] as const;

/** Where a parcel is, normalised from whatever the shop or carrier app says. */
export const parcelStatuses = [
  "ordered",
  "shipped",
  "in_transit",
  "out_for_delivery",
  "pickup_ready",
  "delivered",
  "exception",
  "returned",
  "unknown",
] as const;
export type ParcelStatus = (typeof parcelStatuses)[number];
export type Category = (typeof categories)[number];

/** The major food allergens, checked against the user's own (Settings → Food). */
export const allergens = ["gluten", "milk", "eggs", "peanuts", "nuts", "soy", "fish", "shellfish", "sesame"] as const;
export type Allergen = (typeof allergens)[number];

/** Personal papers kept in "Mes papiers". */
export const paperKinds = ["id_card", "passport", "driving_license", "vehicle_registration", "insurance", "warranty", "certificate", "other"] as const;
export type PaperKind = (typeof paperKinds)[number];

/** What a bill is for, to sum up spending by kind. */
export const billKinds = ["electricity_water", "phone_internet", "tv", "rent", "school", "health", "other"] as const;
export type BillKind = (typeof billKinds)[number];

/** Diets a food is checked against. */
export const diets = ["vegetarian", "vegan", "gluten_free", "lactose_free", "halal", "low_sugar", "low_salt"] as const;
export type Diet = (typeof diets)[number];

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
  questions: z
    .array(z.string())
    .describe("3 short follow-up questions the user would likely ask about this exact photo, in the user's language, under 60 characters each."),
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
  diet: z
    .object({
      allergens: z
        .array(z.enum(allergens))
        .describe("Major allergens it likely contains: from the visible ingredients, the label, or the usual recipe of the dish."),
      diets: z
        .array(z.object({ diet: z.enum(diets), fits: z.enum(["yes", "no", "unsure"]) }))
        .describe("Every diet of the list, once each: whether this food fits it. 'unsure' when it depends on what can't be seen."),
      note: z.string().nullable().describe("One short caution (hidden allergens, cross-contamination, how sure this is), or null."),
    })
    .nullable()
    .describe("Allergens and diets. Only for food, null otherwise."),
  document: z
    .object({
      type: z.string().describe("Kind of document, e.g. invoice, letter, receipt."),
      keyPoints: z.array(z.string()),
      dates: z.array(z.object({ label: z.string(), date: z.string() })),
      actionItems: z.array(z.string()),
      expiresOn: z
        .string()
        .nullable()
        .describe("The date the document expires or is due, as YYYY-MM-DD (insurance end date, bill due date, ID expiry), or null if none is legible."),
      isInsurance: z.boolean().describe("True for any insurance document: certificate, policy, attestation, green card, renewal notice."),
      paper: z
        .enum(paperKinds)
        .nullable()
        .describe(
          "When it is a personal paper worth keeping: id_card (national ID, CNI), passport, driving_license, vehicle_registration (carte grise), insurance, warranty (guarantee card or receipt with a warranty), certificate (birth, residence, diploma, tax…), other; null for bills, letters, receipts and other documents.",
        ),
      bill: z
        .object({
          issuer: z.string().nullable().describe("Who asks for the payment, e.g. JIRAMA, Telma, Orange, Airtel, Canal+, a school; null if not shown."),
          kind: z.enum(billKinds).describe("electricity_water (JIRAMA…), phone_internet, tv, rent, school, health or other."),
          amount: z.number().nullable().describe("The total to pay (or paid), as a plain number in the bill's currency; null if not legible."),
          currency: z.string().nullable().describe("ISO code of that amount: MGA for ariary, EUR, USD…; null if not shown."),
          period: z.string().nullable().describe("The period billed, e.g. 'septembre 2026', or null."),
          dueDate: z.string().nullable().describe("The payment deadline as YYYY-MM-DD, or null."),
        })
        .nullable()
        .describe("Only for a bill, invoice or receipt with an amount to pay or paid; null otherwise."),
    })
    .nullable()
    .describe("Only for documents, null otherwise."),
  vehicle: z
    .object({
      make: z.string().describe("Brand, e.g. Toyota."),
      model: z.string().describe("Model, e.g. Corolla."),
      generation: z.string().nullable().describe("Generation or production years, e.g. '2019–2024', or null if unsure."),
      kind: z.string().describe("Car, motorbike, scooter, van, truck…"),
      priceNew: z.string().nullable().describe("Typical new price range with currency, or null if no longer sold new."),
      priceUsed: z.string().nullable().describe("Typical used price range with currency, given the visible condition."),
      specs: z
        .array(z.object({ label: z.string(), value: z.string() }))
        .describe("4 to 8 key specs: engine, power, fuel, consumption, gearbox, seats, boot volume…"),
      maintenance: z
        .array(z.object({ task: z.string(), interval: z.string() }))
        .describe("Main maintenance items and their usual interval, e.g. oil change / every 10,000 km or 1 year."),
      tips: z.array(z.string()).describe("2 to 4 practical tips to drive, maintain or keep it longer."),
      watchOuts: z.array(z.string()).describe("Known weak points, recalls and what to check before buying."),
    })
    .nullable()
    .describe("Only for vehicles (car, motorbike, scooter, truck…), null otherwise."),
  parcel: z
    .object({
      platform: z.string().nullable().describe("Shop or app, e.g. Pinduoduo, Temu, AliExpress, Shein, Amazon, Jumia; null if unknown."),
      orderNumber: z.string().nullable().describe("Order number exactly as shown, or null."),
      trackingNumber: z.string().nullable().describe("Carrier tracking number exactly as shown, or null."),
      carrier: z.string().nullable().describe("Delivery company in Latin letters, e.g. 'STO Express' for 申通快递; null if not shown."),
      status: z.enum(parcelStatuses).describe("Normalised delivery status."),
      statusLabel: z.string().describe("The status as a short phrase in the user's language, e.g. 'En transit'."),
      lastEvent: z
        .object({
          description: z.string().describe("What happened, translated into the user's language."),
          location: z.string().nullable().describe("City or hub, in Latin letters, or null."),
          at: z.string().nullable().describe("Date and time as 'YYYY-MM-DD HH:mm', or null if not shown."),
        })
        .nullable()
        .describe("The most recent tracking event shown, or null."),
      items: z
        .array(
          z.object({
            name: z.string().describe("Short product name, translated into the user's language."),
            variant: z.string().nullable().describe("Colour, size or option chosen, or null."),
            quantity: z.number(),
            price: z.string().nullable().describe("Unit price with currency, or null."),
          }),
        )
        .describe("Items in the order."),
      total: z.string().nullable().describe("Amount paid with currency, e.g. '¥221.45', or null."),
      seller: z.string().nullable().describe("Shop or seller name, or null."),
      orderedAt: z.string().nullable().describe("Order date as YYYY-MM-DD, or null."),
      shippedAt: z.string().nullable().describe("Shipping date as YYYY-MM-DD, or null."),
      estimatedDelivery: z.string().nullable().describe("Expected delivery date as YYYY-MM-DD, or null if not shown."),
      destinationCity: z
        .string()
        .nullable()
        .describe("Destination city or region only. Never the recipient's name, phone number or street address."),
    })
    .nullable()
    .describe("Only for parcels (order, shipping or tracking screens and shipping labels), null otherwise."),
  list: z
    .object({
      kind: z.enum(listKinds).describe("shopping: things to buy; todo: tasks to do; other: any other list."),
      items: z
        .array(
          z.object({
            text: z.string().describe("The item as written (translated into the user's language if needed), without its quantity."),
            quantity: z.string().nullable().describe("Quantity with its unit when written, e.g. '2 kg', 'x3', or null."),
            done: z.boolean().describe("True when the item is ticked or crossed out on the photo."),
          }),
        )
        .describe("Every item, in the order written."),
    })
    .nullable()
    .describe("Only for lists (shopping lists, to-do lists, checklists), null otherwise."),
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

/**
 * Analyses saved by older versions lack fields added since (recipe, vehicle,
 * document expiry…). Fills them in so stored data still validates.
 */
export function normalizeStoredAnalysis(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const analysis = raw as Record<string, unknown>;
  const document = analysis.document as Record<string, unknown> | null | undefined;
  return {
    questions: [],
    recipe: null,
    diet: null,
    vehicle: null,
    parcel: null,
    list: null,
    ...analysis,
    document: document ? { expiresOn: null, isInsurance: false, paper: null, bill: null, ...document } : null,
  };
}

export const imageMediaTypes = ["image/jpeg", "image/png", "image/webp"] as const;

// ~5 MB decoded is Claude's per-image limit; base64 inflates by 4/3.
export const MAX_IMAGE_BASE64_LENGTH = Math.floor((5 * 1024 * 1024 * 4) / 3);

/** A multi-page scan (Premium and up) sends at most this many pages. */
export const MAX_PAGES = 8;

const PageSchema = z.object({
  image: z.string().min(1).max(MAX_IMAGE_BASE64_LENGTH),
  mediaType: z.enum(imageMediaTypes),
});
export type PageImage = z.infer<typeof PageSchema>;

/** The pages after the first one, in order: a document scanned in several photos. */
const ExtraPagesSchema = z.array(PageSchema).max(MAX_PAGES - 1).optional();

/** Every photo of a request, the first one included. */
export function imagesOf(input: { image: string; mediaType: PageImage["mediaType"]; pages?: PageImage[] }): PageImage[] {
  return [{ image: input.image, mediaType: input.mediaType }, ...(input.pages ?? [])];
}

/** Languages a document's text can be translated into. */
export const translateLanguages = ["fr", "en", "mg", "zh"] as const;
export type TranslateLanguage = (typeof translateLanguages)[number];

export const AnalyzeRequestSchema = z.object({
  image: z.string().min(1).max(MAX_IMAGE_BASE64_LENGTH),
  mediaType: z.enum(imageMediaTypes),
  mode: z.enum(scanModes),
  locale: z.enum(["fr", "en"]),
  /** Analyse again with the more capable model (Premium and up). */
  deep: z.boolean().optional(),
  /** Multi-page scan (Premium and up): the other pages. */
  pages: ExtraPagesSchema,
});

export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;

// ---- Follow-up questions about a scan ----------------------------------------

export const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(2000),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const AskRequestSchema = z.object({
  /** The scan's photo, sent again so the model can look at it. */
  image: z.string().min(1).max(MAX_IMAGE_BASE64_LENGTH),
  mediaType: z.enum(imageMediaTypes),
  /** The earlier analysis, as context (validated against AnalysisSchema server-side). */
  analysis: z.unknown(),
  messages: z
    .array(ChatMessageSchema)
    .min(1)
    .max(40)
    .refine((messages) => messages[messages.length - 1].role === "user", "The last message must be the user's question."),
  locale: z.enum(["fr", "en"]),
  /** The other pages of a multi-page scan. */
  pages: ExtraPagesSchema,
  /** "transcribe": the full text, as written; "translate": that text in `target`. Default: a question. */
  task: z.enum(["chat", "transcribe", "translate"]).optional(),
  target: z.enum(translateLanguages).optional(),
});
export type AskRequest = Omit<z.infer<typeof AskRequestSchema>, "analysis"> & { analysis: Analysis };
export type AskResponse = {
  answer: string;
  model: string;
  demo: boolean;
  /** Questions asked today against the plan's daily allowance (server's key only). */
  usage?: TrialState;
};

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
    /** Present when the analysis used the server's key on the free trial. */
    trial?: TrialState;
    /** Present when it used the server's key on a plan: scans this month. */
    quota?: TrialState;
    /** A deep analysis, and the month's deep analyses used. */
    deep?: boolean;
    deepQuota?: TrialState;
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
  | "ask_limit"
  /** The server's daily AI budget is spent (all users together). */
  | "server_busy"
  /** The feature (an own AI key) needs a subscription. */
  | "plan_required"
  /** This month's scans of the plan are used up. */
  | "plan_limit"
  /** This month's deep analyses are used up. */
  | "deep_limit"
  /** The admin token is right: a code from the authenticator app is needed (or was wrong). */
  | "second_factor"
  | "method_not_allowed";

export type ApiErrorBody = {
  error: { code: ApiErrorCode; message: string };
};
