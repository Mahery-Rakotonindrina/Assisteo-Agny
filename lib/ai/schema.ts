import { z } from "zod";
import { expenseCategories, incomeKinds } from "@/lib/expenses";

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

/** How a parcel travels to Madagascar: by air ("NORMAL" at the forwarders) or by sea ("SEA"). */
export const shippingModes = ["air", "sea"] as const;
export type ShippingMode = (typeof shippingModes)[number];
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

/** A vehicle's fuel, read on a registration certificate or chosen in "Mon garage". */
export const vehicleEnergies = ["petrol", "diesel", "hybrid", "electric", "other"] as const;
export type VehicleEnergy = (typeof vehicleEnergies)[number];

/**
 * Which way the money went: paid or sent (out), received from someone else
 * (in), or moved between the user's own pockets (own: a withdrawal, a
 * deposit, a transfer to their own account). Null reads as out.
 */
export const receiptDirections = ["out", "in", "own"] as const;
export type ReceiptDirection = (typeof receiptDirections)[number];

/**
 * Money moved between one's own pockets, which way: cash withdrawn from a
 * Mobile Money or bank account (withdrawal), cash put on it (deposit), or
 * one account to another (transfer). Null when not "own" or unclear.
 */
export const ownKinds = ["withdrawal", "deposit", "transfer"] as const;
export type OwnKind = (typeof ownKinds)[number];

/** How a receipt was paid, and with which Mobile Money operator. */
export const receiptPayments = ["cash", "mobile_money", "card"] as const;
export type ReceiptPayment = (typeof receiptPayments)[number];
export const mobileMoneyOperators = ["mvola", "orange_money", "airtel_money"] as const;
export type MobileMoneyOperator = (typeof mobileMoneyOperators)[number];

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
      registration: z
        .object({
          plate: z.string().nullable().describe("Registration number exactly as printed (field A), e.g. '1234 TBA'; null if not legible."),
          make: z.string().nullable().describe("Make (field D.1), e.g. Toyota; null if not legible."),
          model: z.string().nullable().describe("Type or commercial name (fields D.2 / D.3), e.g. Corolla; null if not legible."),
          firstRegistration: z.string().nullable().describe("Date of first registration (field B) as YYYY-MM-DD, or null."),
          vin: z.string().nullable().describe("Vehicle identification number (field E), exactly as printed, or null."),
          energy: z.enum(vehicleEnergies).nullable().describe("Fuel (field P.3): petrol (ES, essence), diesel (GO, gazole), hybrid, electric (EL), other; null if not shown."),
          fiscalPower: z.number().nullable().describe("Fiscal horsepower (field P.6, CV) as a number, or null."),
        })
        .nullable()
        .describe("Only for a vehicle registration certificate (carte grise); null otherwise."),
      receipt: z
        .object({
          total: z.number().nullable().describe("The total paid, fees included, as a plain number in the receipt's currency; null if not legible."),
          currency: z.string().nullable().describe("ISO code of that total: MGA for ariary (Ar, MGA, Fmg converted), EUR, USD, CNY…; null if not shown."),
          date: z.string().nullable().describe("The day it was paid, as YYYY-MM-DD, or null."),
          merchant: z.string().nullable().describe("The shop, or for a Mobile Money transfer the recipient's or merchant's name (never a phone number); null if not shown."),
          payment: z.enum(receiptPayments).nullable().describe("cash, mobile_money (MVola, Orange Money, Airtel Money) or card; null if not shown."),
          operator: z.enum(mobileMoneyOperators).nullable().describe("The Mobile Money operator: mvola, orange_money or airtel_money; null otherwise."),
          category: z
            .enum(expenseCategories)
            .nullable()
            .describe(
              "Best budget category: market (food, groceries, supermarket), jirama (water, electricity), rent, transport (taxi, fuel, bus), phone (credit, internet), school, health (pharmacy, doctor), family, online (online shopping), car, leisure, savings, other.",
            ),
          reference: z.string().nullable().describe("The transaction or receipt reference exactly as printed (Mobile Money transaction ID, ticket number); null if none."),
          direction: z
            .enum(receiptDirections)
            .nullable()
            .describe(
              "out when the user paid a merchant, sent money to another person or bought phone credit (a till receipt, a payment, a transfer sent); in when the user received money from someone else (Mobile Money \"Vous avez reçu…\", \"You have received…\": merchant is then the sender's name); own when the money only moved between the user's own pockets: cash withdrawn at an agent or a counter (\"Retrait\"), cash deposited on their own account (\"Dépôt\"), a transfer between their own accounts (Mobile Money to bank, bank to Mobile Money, one operator to another); null if unclear.",
            ),
          fees: z.number().nullable().describe("The fees shown on their own (withdrawal or transfer fees), as a plain number in the receipt's currency; null if none shown."),
          ownKind: z
            .enum(ownKinds)
            .nullable()
            .describe(
              "Only when direction is own: withdrawal when cash was taken out of the Mobile Money or bank account (\"Retrait\", at an agent or a counter), deposit when cash was put on it (\"Dépôt\"), transfer when it went from one of the user's accounts to another (Mobile Money to bank, one operator to another); null otherwise or if unclear.",
            ),
        })
        .nullable()
        .describe("Only for proof of a payment already made: a till receipt, a shop invoice or a Mobile Money (MVola, Orange Money, Airtel Money) confirmation, SMS or screen; null otherwise."),
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
      shippingMode: z
        .enum(shippingModes)
        .nullable()
        .describe(
          "How it travels to Madagascar when the screen or label says so: sea for sea freight (SEA, 海运, maritime, bateau, conteneur), air for air freight (NORMAL, AIR, 空运, aérien, avion); null if not shown.",
        ),
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
    list: null,
    ...analysis,
    document: document
      ? {
          expiresOn: null,
          isInsurance: false,
          paper: null,
          bill: null,
          registration: null,
          receipt: null,
          ...document,
          // Read before the direction, the fees and the kind of own move existed: money paid, no fees apart.
          ...(document.receipt ? { receipt: { direction: null, fees: null, ownKind: null, ...(document.receipt as Record<string, unknown>) } } : {}),
        }
      : null,
    parcel: analysis.parcel ? { shippingMode: null, ...(analysis.parcel as Record<string, unknown>) } : null,
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

// ---- "Mes dépenses": the month's review --------------------------------------
// Only totals leave the device: no note, no shop, no single expense.

const amount = z.number().int().min(0).max(1_000_000_000_000);

export const ExpenseSummaryRequestSchema = z.strictObject({
  locale: z.enum(["fr", "en"]),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  /** The day of the month reached when the month is still going, else null. */
  dayOfMonth: z.number().int().min(1).max(31).nullable(),
  daysInMonth: z.number().int().min(28).max(31),
  total: amount,
  previousTotal: amount,
  /** The average month over the 6 before this one. */
  averageTotal: amount,
  income: amount.nullable(),
  budget: amount.nullable(),
  // Optional, never a name (older apps don't send them): what is in the pockets at the
  // start and the end of the month, the net put aside in goals, the tontine payments and
  // the reselling's profit. Pockets, savings and profit can go below 0.
  pocketsStart: z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000).optional(),
  pocketsEnd: z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000).optional(),
  savedThisMonth: z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000).optional(),
  tontinePaid: amount.optional(),
  activityProfit: z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000).optional(),
  categories: z
    .array(
      z.strictObject({
        name: z.string().trim().min(1).max(40),
        amount,
        previous: amount,
        average: amount,
        cap: amount.nullable(),
      }),
    )
    .max(30),
});
export type ExpenseSummaryRequest = z.infer<typeof ExpenseSummaryRequestSchema>;

export const ExpenseSummarySchema = z.object({
  findings: z.array(z.string()).describe("3 to 5 short findings, each with a figure (an amount or a percentage)."),
  tips: z.array(z.string()).describe("2 or 3 concrete, realistic tips for a household in Madagascar."),
});
export type ExpenseSummary = z.infer<typeof ExpenseSummarySchema>;

export type ExpenseSummaryResponse = { summary: ExpenseSummary; model: string; demo: boolean };

// ---- "Mes dépenses": a Mobile Money or bank statement ------------------------
// Screenshots of the history or the statement's PDF, read once: the images are
// neither kept on the server nor in the scans' history.

/** Screenshots of one statement sent at once (each counts as a scan). */
export const MAX_STATEMENT_PAGES = 10;
/** A statement's PDF: about 3 MB, so the request stays under the host's 4.5 MB. */
export const MAX_STATEMENT_PDF_BASE64_LENGTH = Math.floor((3 * 1024 * 1024 * 4) / 3);

export const StatementRequestSchema = z
  .strictObject({
    locale: z.enum(["fr", "en"]),
    pages: z.array(PageSchema).min(1).max(MAX_STATEMENT_PAGES).optional(),
    pdf: z.string().min(1).max(MAX_STATEMENT_PDF_BASE64_LENGTH).optional(),
    /** The user's day (YYYY-MM-DD), for the "Aujourd'hui" and "Hier" of the histories. */
    today: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/).optional(),
  })
  .refine((input) => Boolean(input.pages) !== Boolean(input.pdf), "Send either screenshots or one PDF.");
export type StatementRequest = z.infer<typeof StatementRequestSchema>;

export const statementKinds = ["mobile_money", "bank"] as const;
/** Which way an operation moved this account's money. */
export const statementSides = ["debit", "credit"] as const;

export const StatementOperationSchema = z.object({
  date: z.string().nullable().describe("The day of the operation, as YYYY-MM-DD; null if not shown."),
  amount: z.number().describe("The amount moved, fees apart, as a positive plain number in the statement's currency."),
  direction: z
    .enum(receiptDirections)
    .describe(
      "out when the user paid or sent money to someone else (a payment, a transfer sent, phone credit, a bill); in when the user received money from someone else; own when the money only moved between the user's own pockets: cash withdrawn (\"Retrait\"), cash deposited on their own account (\"Dépôt\"), a transfer between their own accounts.",
    ),
  side: z.enum(statementSides).describe("debit when the money left this account (a payment, a transfer sent, a withdrawal), credit when it came into it (money received, a deposit)."),
  ownKind: z.enum(ownKinds).nullable().describe("Only when direction is own: withdrawal, deposit or transfer; null otherwise."),
  counterparty: z.string().nullable().describe("The other side's name (merchant, person, bank): never a phone number or an account number; null if none."),
  reference: z.string().nullable().describe("The transaction reference or ID exactly as printed; null if none."),
  fees: z.number().nullable().describe("The fees of this operation shown apart, as a plain number; null if none."),
  category: z
    .enum(expenseCategories)
    .nullable()
    .describe("For out: the best budget category (market, jirama, rent, transport, phone, school, health, family, online, car, leisure, savings, other); null otherwise."),
  incomeKind: z.enum(incomeKinds).nullable().describe("For in: salary, sales (a client paid), family (help from relatives) or other; null otherwise."),
  balanceAfter: z.number().nullable().describe("The balance shown right after this operation, as a plain number; null if not shown."),
});
export type StatementOperation = z.infer<typeof StatementOperationSchema>;

export const StatementSchema = z.object({
  institution: z.string().nullable().describe("The operator or bank as named on the statement (\"MVola\", \"Orange Money\", \"BNI Madagascar\"…); null if unclear."),
  kind: z.enum(statementKinds).nullable().describe("mobile_money for MVola, Orange Money or Airtel Money; bank for a bank; null if unclear."),
  operator: z.enum(mobileMoneyOperators).nullable().describe("The Mobile Money operator: mvola, orange_money or airtel_money; null for a bank."),
  currency: z.string().nullable().describe("ISO code of the amounts: MGA for ariary (Ar), EUR, USD…; null if not shown."),
  periodStart: z.string().nullable().describe("The first day the statement covers, as YYYY-MM-DD; null if not shown."),
  periodEnd: z.string().nullable().describe("The last day the statement covers, as YYYY-MM-DD; null if not shown."),
  closingBalance: z.number().nullable().describe("The balance at the end of the statement (the most recent one shown); null if not shown."),
  operations: z.array(StatementOperationSchema).describe("Every operation shown, each once, in the order printed."),
});
export type Statement = z.infer<typeof StatementSchema>;

export type StatementResponse = { statement: Statement; model: string; demo: boolean; pages: number };

// ---- "Prêts": a debt acknowledgment read by the AI ----------------------------
// The photo is read and forgotten: nothing is kept on the server.

export const LoanScanRequestSchema = z.strictObject({
  image: z.string().min(1).max(MAX_IMAGE_BASE64_LENGTH),
  mediaType: z.enum(imageMediaTypes),
  locale: z.enum(["fr", "en"]),
});
export type LoanScanRequest = z.infer<typeof LoanScanRequestSchema>;

const day = z.string().describe("YYYY-MM-DD");

export const LoanReadingSchema = z.object({
  isAcknowledgment: z.boolean().describe("True when the photo is a debt acknowledgment, an IOU or a written loan agreement."),
  lender: z.string().nullable().describe("The name of who lends the money (the creditor), exactly as written; null if not legible."),
  borrower: z.string().nullable().describe("The name of who borrows and owes the money (the debtor), exactly as written; null if not legible."),
  amountFigures: z.number().nullable().describe("The amount written in figures, in ariary (Malagasy francs, FMG, divided by 5); null if absent."),
  amountWords: z.string().nullable().describe("The amount written in words, copied as written; null if absent."),
  amountWordsValue: z.number().nullable().describe("The value of the amount in words, in ariary; null if absent."),
  date: day.nullable().describe("The day the money was lent, YYYY-MM-DD; null if absent."),
  dueDate: day.nullable().describe("The day it must be paid back by, YYYY-MM-DD; null if absent."),
  installments: z
    .array(z.object({ dueDate: day, amount: z.number().describe("In ariary.") }))
    .describe("The repayment schedule when it is paid back in several times, oldest first; empty otherwise."),
  interest: z
    .object({ kind: z.enum(["fixed", "percent"]), value: z.number().describe("In ariary when fixed, a percentage of the amount otherwise.") })
    .nullable()
    .describe("Interest or fees agreed on top of the amount; null without."),
  place: z.string().nullable().describe("The place where it was signed (\"Fait à …\"); null if absent."),
});
export type LoanReading = z.infer<typeof LoanReadingSchema>;

export type LoanScanResponse = {
  reading: LoanReading;
  model: string;
  demo: boolean;
  /** Scans used this month against the plan's (server's key). */
  quota?: TrialState;
};

// ---- Selling an object: the classified ad written by the AI -------------------

/** The condition the seller picks, worst last. */
export const objectConditions = ["new", "veryGood", "good", "worn", "toRepair"] as const;
export type ObjectCondition = (typeof objectConditions)[number];

export const ObjectAdRequestSchema = z.strictObject({
  /** The scan's photo, sent again so the model can look at it. */
  image: z.string().min(1).max(MAX_IMAGE_BASE64_LENGTH),
  mediaType: z.enum(imageMediaTypes),
  /** The scan's analysis, as context (validated against AnalysisSchema server-side). */
  analysis: z.unknown(),
  condition: z.enum(objectConditions),
  /** The town where it is sold, when the seller gives it. */
  place: z.string().trim().max(60).optional(),
  locale: z.enum(["fr", "en"]),
  /** The text in Malagasy too. */
  malagasy: z.boolean().optional(),
});
export type ObjectAdRequest = z.infer<typeof ObjectAdRequestSchema>;

export const ObjectAdSchema = z.object({
  title: z.string().describe("The ad's title, under 70 characters: what it is, brand and model when visible, the condition."),
  text: z.string().describe("3 to 6 short, honest sentences: what it is, its strong points, its visible defects, the place, an invitation to get in touch."),
  price: z.number().describe("The suggested asking price in ariary (MGA), as a plain number."),
  priceLow: z.number().describe("The low end of the fair price range in ariary."),
  priceHigh: z.number().describe("The high end of the fair price range in ariary."),
  keywords: z.array(z.string()).describe("3 to 5 lowercase search words buyers would type, without #."),
  textMg: z.string().nullable().describe("The same text in Malagasy when asked, null otherwise."),
});
export type ObjectAd = z.infer<typeof ObjectAdSchema>;

export type ObjectAdResponse = {
  ad: ObjectAd;
  model: string;
  demo: boolean;
  /** Questions asked today against the daily allowance (the ad counts as one). */
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
  /** An admin other than the owner tried what only the owner may do (the second factor, admin rights). */
  | "owner_only"
  /** The request needs a signed-in account. */
  | "sign_in_required"
  /** "Mes dépenses" shared: the account already has a household, or isn't in this one. */
  | "already_member"
  | "not_member"
  /** Only the household's creator may do this. */
  | "not_owner"
  /** An invitation code that doesn't exist (or was revoked), or is past its 48 hours. */
  | "invalid_code"
  | "expired"
  | "household_full"
  /** Admin: a setting that needs a database migration not applied yet (supabase/migrations). */
  | "migration_needed"
  /** A shared loan link that doesn't exist or was stopped (the same answer for both). */
  | "not_found"
  | "method_not_allowed";

export type ApiErrorBody = {
  error: { code: ApiErrorCode; message: string };
};
