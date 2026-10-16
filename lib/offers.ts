import { activePlan, periodEnd, planRank, soldPlans, type Duration, type PlanOffer, type SoldPlanId, type Subscription } from "./plans";

// Pure rules of the offered accesses: the yearly price, the Premium trial,
// the promo codes and the referral reward. The server applies them
// (pages/api/offers/*, pages/api/admin/*); the offers page shows them.

export const DAY_MS = 24 * 3600 * 1000;
export const TRIAL_DAYS = 7;

/** `payment_method` of the accesses given without a payment (amount null). */
export const offeredMethods = ["trial", "promo", "referral"] as const;
export type OfferedMethod = (typeof offeredMethods)[number];

// ---- Yearly price -------------------------------------------------------------

/** The default yearly price: ten months, so two are offered. */
export const defaultYearPrice = (priceMga: number) => priceMga * 10;

/** Whole months offered by paying for a year rather than twelve months; 0 if none. */
export function monthsFree(offer: Pick<PlanOffer, "priceMga" | "yearPriceMga">) {
  if (offer.priceMga <= 0 || !offer.yearPriceMga) return 0;
  return Math.max(0, Math.floor((offer.priceMga * 12 - offer.yearPriceMga) / offer.priceMga));
}

// ---- Premium trial ------------------------------------------------------------

/** Once per account: never had a trial, nor Premium or above (paid or offered). */
export function trialEligible(rows: Array<Pick<Subscription, "plan" | "paymentMethod">>) {
  return !rows.some((row) => row.paymentMethod === "trial" || planRank[row.plan] >= planRank.premium);
}

/** True when the e-mail has paid for something (an amount above 0). */
export const hasPaid = (rows: Array<Pick<Subscription, "amountMga">>) => rows.some((row) => (row.amountMga ?? 0) > 0);

// ---- Promo codes --------------------------------------------------------------

/** Either an access (a plan for some days) or a discount on the next payment. */
export type PromoCode = {
  code: string;
  kind: "access" | "discount";
  /** Access codes: the plan and how many days. */
  plan: SoldPlanId;
  days: number;
  /** Discount codes: the percentage off. */
  percent: number;
  /** 0 = no limit. */
  maxUses: number;
  /** Epoch ms after which the code no longer works; null = never. */
  expiresAt: number | null;
  active: boolean;
  createdAt: number;
};

/** A code as listed in /admin, with how many times it was used. */
export type PromoWithUses = PromoCode & { uses: number };

export const CODE_PATTERN = /^[A-Z0-9-]{3,24}$/;

/** "  noel-2026 " → "NOEL-2026": codes are typed in any case, with stray spaces. */
export const normalizeCode = (input: string) => input.trim().toUpperCase().replace(/\s+/g, "");

export type PromoProblem = "inactive" | "expired" | "used_up";

/** Why a code can't be used right now, or null when it can. */
export function promoProblem(promo: Pick<PromoCode, "active" | "expiresAt" | "maxUses">, uses: number, now: number): PromoProblem | null {
  if (!promo.active) return "inactive";
  if (promo.expiresAt !== null && now >= promo.expiresAt) return "expired";
  if (promo.maxUses > 0 && uses >= promo.maxUses) return "used_up";
  return null;
}

/**
 * Whether a waiting discount still counts: its code exists, is still a
 * discount, active and not expired. Its use was taken when it was entered,
 * so the limit is not checked again.
 */
export function discountStillValid(promo: Pick<PromoCode, "kind" | "active" | "expiresAt"> | null, now: number) {
  return promo !== null && promo.kind === "discount" && promo.active && (promo.expiresAt === null || now < promo.expiresAt);
}

/** A price with a discount, rounded to the ariary. */
export const discountedPrice = (priceMga: number, percent: number) => Math.max(0, Math.round((priceMga * (100 - Math.min(100, Math.max(0, percent)))) / 100));

/**
 * The amount the Admin's form suggests for a payment: the yearly price for a
 * year, and with a waiting discount the reduced price of the period chosen.
 * Null when there is nothing to suggest (the admin types it).
 */
export function suggestedAmount(offer: Pick<PlanOffer, "priceMga" | "yearPriceMga">, duration: Duration | "custom", percent: number | null) {
  const months: Partial<Record<Duration | "custom", number>> = { month: 1, quarter: 3, half: 6 };
  if (duration !== "year" && percent === null) return null;
  const base = duration === "year" ? offer.yearPriceMga : months[duration] ? offer.priceMga * months[duration] : null;
  if (!base) return null;
  return percent === null ? base : discountedPrice(base, percent);
}

/** The period of an offered access: from `now`, for `days` days. */
export const accessPeriod = (now: number, days: number) => ({ startsAt: new Date(now).toISOString(), endsAt: new Date(now + days * DAY_MS).toISOString() });

// ---- Referral -----------------------------------------------------------------

// No 0/O, 1/I/L: read aloud or copied by hand.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** A short and stable referral code, derived from the account id (a uuid). */
export function referralCodeFor(accountId: string) {
  // FNV-1a over the id, twice with different seeds: 7 characters of a 31-letter alphabet.
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (const char of accountId.toLowerCase()) {
    a = Math.imul(a ^ char.charCodeAt(0), 0x01000193) >>> 0;
    b = Math.imul(b ^ char.charCodeAt(0), 0x811c9dc5) >>> 0;
  }
  let value = a * 2 ** 21 + (b >>> 11);
  let code = "";
  for (let index = 0; index < 7; index++) {
    code += ALPHABET[value % ALPHABET.length];
    value = Math.floor(value / ALPHABET.length);
  }
  return code;
}

/**
 * The referrer's month: their sold plan running now (Lite if none), starting
 * when what they have runs out, else now.
 */
export function referralReward(rows: Array<Pick<Subscription, "plan" | "startsAt" | "endsAt">>, now: number) {
  const current = activePlan(rows, now);
  const plan: SoldPlanId = (soldPlans as readonly string[]).includes(current.plan) ? (current.plan as SoldPlanId) : "lite";
  // The coverage of that plan (an admin's plan doesn't delay a Lite month).
  const covered = activePlan(rows.filter((row) => planRank[row.plan] >= planRank[plan] && row.plan !== "unlimited"), now);
  const start = new Date(covered.plan !== "free" && covered.endsAt !== null && covered.endsAt > now ? covered.endsAt : now);
  return { plan, startsAt: start.toISOString(), endsAt: periodEnd(start, "month")!.toISOString() };
}
