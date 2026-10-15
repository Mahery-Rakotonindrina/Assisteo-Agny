import type { PromoCode, PromoWithUses } from "@/lib/offers";
import { redis } from "./redis";

// What the promo codes, the discounts, the referrals and the Premium trial
// need to remember, beside the subscriptions themselves (which stay in
// Supabase). In Redis; in process memory without it, which a restart or
// another serverless instance forgets (shown in /admin).

export const offersAreDurable = Boolean(redis);

const CODES = "promo:codes";
const uses = (code: string) => `promo:uses:${code}`;
const redeemed = (code: string) => `promo:redeemed:${code}`;
const discountKey = (email: string) => `promo:discount:${email}`;
const referralKey = (code: string) => `ref:code:${code}`;
const parentKey = (email: string) => `ref:parent:${email}`;
const rewardedKey = (email: string) => `ref:rewarded:${email}`;
const trialKey = (email: string) => `offers:trial:${email}`;

// ---- Memory fallback ----------------------------------------------------------

const memory = {
  codes: new Map<string, PromoCode>(),
  counters: new Map<string, number>(),
  sets: new Map<string, Set<string>>(),
  values: new Map<string, unknown>(),
};

async function incr(key: string, by = 1) {
  if (redis) return by === 1 ? redis.incr(key) : redis.decr(key);
  const next = (memory.counters.get(key) ?? 0) + by;
  memory.counters.set(key, next);
  return next;
}

/** Sets a value only if absent: true when this call set it (atomic in Redis). */
async function setOnce(key: string, value: string) {
  if (redis) return (await redis.set(key, value, { nx: true })) === "OK";
  if (memory.values.has(key)) return false;
  memory.values.set(key, value);
  return true;
}

async function getValue<T>(key: string) {
  if (redis) return (await redis.get<T>(key)) ?? null;
  return (memory.values.get(key) as T | undefined) ?? null;
}

async function setValue(key: string, value: unknown) {
  if (redis) await redis.set(key, value);
  else memory.values.set(key, value);
}

/** Deletes keys; returns how many existed (atomic in Redis: only one caller gets them). */
async function delValue(...keys: string[]) {
  if (redis) return redis.del(...keys);
  return keys.filter((key) => [memory.values.delete(key), memory.counters.delete(key), memory.sets.delete(key)].some(Boolean)).length;
}

// ---- Promo codes --------------------------------------------------------------

export async function listPromoCodes(): Promise<PromoWithUses[]> {
  const codes = redis
    ? Object.values((await redis.hgetall<Record<string, PromoCode>>(CODES)) ?? {})
    : [...memory.codes.values()];
  const counts = await Promise.all(codes.map((promo) => promoUses(promo.code)));
  return codes.map((promo, index) => ({ ...promo, uses: counts[index] })).sort((a, b) => b.createdAt - a.createdAt);
}

export async function getPromoCode(code: string): Promise<PromoCode | null> {
  if (redis) return (await redis.hget<PromoCode>(CODES, code)) ?? null;
  return memory.codes.get(code) ?? null;
}

export async function savePromoCode(promo: PromoCode) {
  if (redis) await redis.hset(CODES, { [promo.code]: promo });
  else memory.codes.set(promo.code, promo);
}

export async function deletePromoCode(code: string) {
  if (redis) await redis.hdel(CODES, code);
  else memory.codes.delete(code);
  await delValue(uses(code), redeemed(code));
}

export async function promoUses(code: string) {
  if (redis) return Number((await redis.get<number>(uses(code))) ?? 0);
  return memory.counters.get(uses(code)) ?? 0;
}

/** Counts one use; past `maxUses` (0 = no limit) it is taken back and refused. */
export async function takePromoUse(code: string, maxUses: number) {
  const count = await incr(uses(code));
  if (maxUses > 0 && count > maxUses) {
    await incr(uses(code), -1);
    return false;
  }
  return true;
}

/** Takes back a use counted for an access that could not be given. */
export async function returnPromoUse(code: string) {
  await incr(uses(code), -1);
}

/** Marks an access code as used by this e-mail: false if it already was. */
export async function markRedeemed(code: string, email: string) {
  if (redis) return (await redis.sadd(redeemed(code), email)) === 1;
  const set = memory.sets.get(redeemed(code)) ?? new Set<string>();
  memory.sets.set(redeemed(code), set);
  if (set.has(email)) return false;
  set.add(email);
  return true;
}

export async function unmarkRedeemed(code: string, email: string) {
  if (redis) await redis.srem(redeemed(code), email);
  else memory.sets.get(redeemed(code))?.delete(email);
}

// ---- Discounts ----------------------------------------------------------------

export type PendingDiscount = { code: string; percent: number };

export const getDiscount = (email: string) => getValue<PendingDiscount>(discountKey(email));
export const setDiscount = (email: string, discount: PendingDiscount) => setValue(discountKey(email), discount);
/** Forgets the waiting discount: true for the one caller that removed it. */
export const clearDiscount = async (email: string) => (await delValue(discountKey(email))) > 0;

// ---- Referral -----------------------------------------------------------------

/** Remembers whose referral code this is (the first account to claim it keeps it). */
export async function registerReferralCode(code: string, email: string) {
  if (!(await setOnce(referralKey(code), email))) return (await getValue<string>(referralKey(code))) === email;
  return true;
}

export const referrerOfCode = (code: string) => getValue<string>(referralKey(code));
export const parentOf = (email: string) => getValue<string>(parentKey(email));
/** Records who referred this e-mail: false if someone already had. */
export const setParent = (email: string, referrer: string) => setOnce(parentKey(email), referrer);
/** True only the first time: one reward per referred e-mail. */
export const markRewarded = (email: string) => setOnce(rewardedKey(email), "1");
export const unmarkRewarded = (email: string) => delValue(rewardedKey(email));

// ---- Premium trial ------------------------------------------------------------

/** A lock against a double tap: true the first time for this e-mail. */
export const claimTrial = (email: string) => setOnce(trialKey(email), "1");
export const trialClaimed = async (email: string) => (await getValue<string>(trialKey(email))) !== null;
export const releaseTrial =(email: string) => delValue(trialKey(email));
