import { createHash, randomBytes } from "node:crypto";
import { redis } from "./redis";
import { open, seal } from "./secretBox";
import { base32Encode, matchTotp, newTotpSecret } from "./totp";

// Second factor of /admin: after the admin token, a code from an
// authenticator app, or one of the one-time recovery codes. The secret is
// sealed with API_KEYS_SECRET and kept in Redis, so it is turned on from
// /admin without redeploying. Last resort if the phone and the recovery
// codes are both lost: delete the Redis key "config:admin-2fa" (Upstash
// console), which turns it off (docs/admin-2fa.md).

const KEY = "config:admin-2fa";
const PENDING_KEY = "admin:2fa:pending";
const PENDING_S = 15 * 60;
const RECOVERY_CODES = 10;

type Stored = { enabled: true; secret: string; recovery: string[]; since: string } | { enabled: false; since: string };

let memory: Stored | null = null;
let memoryPending: { secret: string; expiresAt: number } | null = null;
const memoryUsed = new Map<number, number>();

export const twoFactorIsDurable = Boolean(redis);

/** Sealing needs API_KEYS_SECRET: without it the second factor can't be turned on. */
export function twoFactorAvailable() {
  try {
    seal("check");
    return true;
  } catch {
    return false;
  }
}

async function read(): Promise<Stored | null> {
  return redis ? await redis.get<Stored>(KEY) : memory;
}

async function write(value: Stored) {
  if (redis) await redis.set(KEY, value);
  else memory = value;
}

export type TwoFactorState = { enabled: boolean; since: string | null; recoveryLeft: number };

export async function twoFactorState(): Promise<TwoFactorState> {
  const stored = await read();
  return { enabled: Boolean(stored?.enabled), since: stored?.since ?? null, recoveryLeft: stored?.enabled ? stored.recovery.length : 0 };
}

/** Changes whenever the second factor is turned on or off: it ends the sessions signed before. */
export function sessionEpoch(state: TwoFactorState) {
  return state.since ?? "initial";
}

const hashRecovery = (code: string) =>
  createHash("sha256")
    .update(code.toUpperCase().replace(/[\s-]/g, ""))
    .digest("hex");

function newRecoveryCodes() {
  return Array.from({ length: RECOVERY_CODES }, () => {
    const code = base32Encode(randomBytes(7)).slice(0, 10).toLowerCase();
    return `${code.slice(0, 5)}-${code.slice(5)}`;
  });
}

/** A code can't be used twice, even within its 30 seconds. */
async function firstUse(step: number) {
  if (redis) return (await redis.set(`admin:2fa:used:${step}`, 1, { nx: true, ex: 120 })) === "OK";
  const now = Date.now();
  for (const [key, expiresAt] of memoryUsed) if (expiresAt < now) memoryUsed.delete(key);
  if (memoryUsed.has(step)) return false;
  memoryUsed.set(step, now + 120_000);
  return true;
}

async function codeMatches(secret: string, code: string) {
  const step = matchTotp(secret, code);
  return step !== null && (await firstUse(step));
}

/** A new secret to scan, waiting for a first code before it counts. */
export async function startTwoFactor() {
  const secret = newTotpSecret();
  if (redis) await redis.set(PENDING_KEY, seal(secret), { ex: PENDING_S });
  else memoryPending = { secret: seal(secret), expiresAt: Date.now() + PENDING_S * 1000 };
  return secret;
}

/** Turns the second factor on once a code from the new secret is right. Returns the recovery codes, or null. */
export async function confirmTwoFactor(code: string) {
  const sealed = redis ? await redis.get<string>(PENDING_KEY) : memoryPending && memoryPending.expiresAt > Date.now() ? memoryPending.secret : null;
  if (!sealed) return null;
  const secret = open(sealed);
  if (!(await codeMatches(secret, code))) return null;
  const recovery = newRecoveryCodes();
  await write({ enabled: true, secret: seal(secret), recovery: recovery.map(hashRecovery), since: new Date().toISOString() });
  if (redis) await redis.del(PENDING_KEY);
  else memoryPending = null;
  return recovery;
}

/** A code from the app, or a recovery code (used up by this). */
export async function checkSecondFactor(code: string) {
  const stored = await read();
  if (!stored?.enabled) return false;
  if (/^\s*\d{3}\s?\d{3}\s*$/.test(code)) return codeMatches(open(stored.secret), code);
  const hash = hashRecovery(code);
  if (!stored.recovery.includes(hash)) return false;
  await write({ ...stored, recovery: stored.recovery.filter((item) => item !== hash) });
  return true;
}

export async function disableTwoFactor() {
  await write({ enabled: false, since: new Date().toISOString() });
}

/** New recovery codes; the old ones stop working. */
export async function renewRecoveryCodes() {
  const stored = await read();
  if (!stored?.enabled) return null;
  const recovery = newRecoveryCodes();
  await write({ ...stored, recovery: recovery.map(hashRecovery) });
  return recovery;
}
