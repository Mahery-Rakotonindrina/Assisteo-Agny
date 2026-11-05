import { defaultReferralConfig, REWARDS_PER_IP, type ReferralConfig, type ReferralRefusal, type ReferralSummary } from "@/lib/referralBonus";
import { parentOf } from "./offerStore";
import { redis } from "./redis";

// The referral bonus: scans won by a friend and by the person who invited
// them, given on the server only, once the friend has a confirmed account and
// makes a scan on the server's AI. The scans are a pool per e-mail, spent only
// after the plan's own scans (or the free trial) are used up. In Redis; in
// process memory without it.

const DAY_S = 24 * 3600;
const configKey = "config:referral";
const bonusKey = (email: string) => `ref:bonus:${email}`;
const wonKey = (email: string) => `ref:won:${email}`;
const childrenKey = (referrer: string) => `ref:children:${referrer}`;
const rewardedKey = (referrer: string) => `ref:rewarded-friends:${referrer}`;
const seenKey = (email: string) => `ref:seen:${email}`;
const onceKey = (email: string) => `ref:scanreward:${email}`;
const installKey = (installId: string) => `ref:install:${installId}`;
const ipKey = (ip: string) => `ref:ip:${ip}`;
const monthKey = (referrer: string) => `ref:month:${referrer}:${new Date().toISOString().slice(0, 7)}`;
const STATS_KEY = "ref:stats:rewarded";

// ---- Storage (Redis, or memory) ---------------------------------------------------

const memory = { numbers: new Map<string, number>(), sets: new Map<string, Set<string>>(), values: new Map<string, unknown>() };

const get = async (key: string) => (redis ? Number((await redis.get<number>(key)) ?? 0) : (memory.numbers.get(key) ?? 0));

async function incrBy(key: string, amount: number, ttlSeconds?: number) {
  if (redis) {
    const value = await redis.incrby(key, amount);
    if (ttlSeconds) await redis.expire(key, ttlSeconds, "NX");
    return value;
  }
  const value = (memory.numbers.get(key) ?? 0) + amount;
  memory.numbers.set(key, value);
  return value;
}

/** Sets the key only if it is absent: true for the one call that set it. */
async function once(key: string, ttlSeconds?: number) {
  if (redis) return (await (ttlSeconds ? redis.set(key, "1", { nx: true, ex: ttlSeconds }) : redis.set(key, "1", { nx: true }))) === "OK";
  if (memory.values.has(key)) return false;
  memory.values.set(key, "1");
  return true;
}

async function addToSet(key: string, member: string, ttlSeconds?: number) {
  if (redis) {
    const added = (await redis.sadd(key, member)) === 1;
    if (ttlSeconds) await redis.expire(key, ttlSeconds);
    return added;
  }
  const set = memory.sets.get(key) ?? new Set<string>();
  memory.sets.set(key, set);
  const added = !set.has(member);
  set.add(member);
  return added;
}

async function members(key: string): Promise<string[]> {
  if (redis) return (await redis.smembers(key)) as string[];
  return [...(memory.sets.get(key) ?? [])];
}

// ---- Settings ---------------------------------------------------------------------

export async function getReferralConfig(): Promise<ReferralConfig> {
  const stored = redis ? await redis.get<Partial<ReferralConfig>>(configKey).catch(() => null) : (memory.values.get(configKey) as Partial<ReferralConfig> | undefined);
  return { ...defaultReferralConfig, ...stored };
}

export async function setReferralConfig(config: ReferralConfig) {
  if (redis) await redis.set(configKey, config);
  else memory.values.set(configKey, config);
}

// ---- The pool of scans ------------------------------------------------------------

/** Scans won and not used yet. */
export const bonusScansLeft = (email: string) => get(bonusKey(email));

/** Spends one won scan: false when there is none. */
export async function takeBonusScan(email: string) {
  if ((await incrBy(bonusKey(email), -1)) >= 0) return true;
  await incrBy(bonusKey(email), 1);
  return false;
}

/** Gives back a won scan taken for an analysis that failed. */
export async function returnBonusScan(email: string) {
  await incrBy(bonusKey(email), 1);
}

// ---- Knowing who is who -------------------------------------------------------------

/** Remembers the installs and addresses an account scanned from (90 days), to spot a friend who is oneself. */
export async function noteDevice(email: string, installId: string | null, ip: string) {
  if (installId) await addToSet(seenKey(email), `i:${installId}`, 90 * DAY_S);
  await addToSet(seenKey(email), `p:${ip}`, 90 * DAY_S);
}

/** A friend entered this referrer's code (counted on the referrer's screen). */
export async function addReferralChild(referrer: string, friend: string) {
  await addToSet(childrenKey(referrer), friend);
}

// ---- The reward ---------------------------------------------------------------------

/**
 * Called after a successful scan on the server's AI by a signed-in account
 * with a confirmed e-mail. If that account entered someone's referral code,
 * and it hasn't been rewarded, both win the configured scans. Once per friend
 * and per install, a few per address, never for oneself (same account, same
 * install or same address as the referrer), and a monthly cap per referrer
 * (above it, the friend still wins).
 */
export async function rewardFirstScan({ email, installId, ip }: { email: string; installId: string | null; ip: string }): Promise<ReferralRefusal | "rewarded"> {
  const referrer = await parentOf(email);
  if (!referrer) return "no_referrer";
  const config = await getReferralConfig();
  if (config.scans <= 0) return "off";
  // Taken first: whatever happens next, this friend is judged only once.
  if (!(await once(onceKey(email)))) return "already";

  if (referrer === email) return "self";
  const seen = new Set(await members(seenKey(referrer)));
  if ((installId && seen.has(`i:${installId}`)) || seen.has(`p:${ip}`)) return "self";
  if (installId && !(await once(installKey(installId)))) return "install";
  if ((await incrBy(ipKey(ip), 1, 30 * DAY_S)) > REWARDS_PER_IP) {
    await incrBy(ipKey(ip), -1);
    return "ip";
  }

  await grant(email, config.scans);
  await addToSet(rewardedKey(referrer), email);
  if ((await incrBy(monthKey(referrer), 1, 40 * DAY_S)) <= config.capPerMonth) await grant(referrer, config.scans);
  else await incrBy(monthKey(referrer), -1);
  await incrBy(STATS_KEY, 1);
  return "rewarded";
}

async function grant(email: string, scans: number) {
  await incrBy(bonusKey(email), scans, 400 * DAY_S);
  await incrBy(wonKey(email), scans, 400 * DAY_S);
}

/** What an account sees: friends invited and rewarded, scans won and left. */
export async function referralSummary(email: string): Promise<ReferralSummary> {
  const [config, invited, rewarded, scansWon, scansLeft] = await Promise.all([
    getReferralConfig(),
    members(childrenKey(email)),
    members(rewardedKey(email)),
    get(wonKey(email)),
    get(bonusKey(email)),
  ]);
  return { invited: invited.length, rewarded: rewarded.length, scansWon, scansLeft: Math.max(0, scansLeft), scansEach: config.scans };
}

/** For Admin: friends rewarded so far. */
export const referralRewardedTotal = () => get(STATS_KEY);

/** Tests only. */
export function resetReferralBonus() {
  memory.numbers.clear();
  memory.sets.clear();
  memory.values.clear();
}
