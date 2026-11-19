import type { Track17Item } from "@/lib/parcelTracking";
import { redis } from "./redis";

// 17TRACK (https://api.17track.net/en/doc), the automatic tracking of "Mes
// colis". The key is TRACK17_API_KEY; without it the tracking sleeps, except
// in the demo mode (AI_DEMO_MODE, the e2e tests) where answers are made up.
// A number is registered once (that is what the quota counts), then read as
// often as needed. Registered numbers are remembered in Redis (in memory
// without it, i.e. locally).

const BASE = "https://api.17track.net/track/v2.2";
/** Numbers per request, at most (both endpoints). */
export const TRACK17_BATCH = 40;
/** 17TRACK allows 3 requests per second. */
const PAUSE_MS = 400;
/** Remembered as registered for this long (17TRACK stops tracking a number after some months anyway). */
const REGISTERED_TTL_S = 200 * 86_400;
/** A number 17TRACK refused (bad format, carrier unknown): not offered again before a week. */
const REFUSED_TTL_S = 7 * 86_400;

const ALREADY_REGISTERED = -18019901;

export type Track17Mode = "live" | "demo" | "off";

export function track17Mode(): Track17Mode {
  if (process.env.TRACK17_API_KEY) return "live";
  return process.env.AI_DEMO_MODE === "true" ? "demo" : "off";
}

type Rejected = { number: string; error?: { code?: number; message?: string } | null };
type Answer<T> = { code?: number; data?: { accepted?: T[]; rejected?: Rejected[] } };

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function call<T>(path: "register" | "gettrackinfo", numbers: string[]): Promise<Answer<T>> {
  const response = await fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: { "17token": process.env.TRACK17_API_KEY ?? "", "Content-Type": "application/json" },
    body: JSON.stringify(numbers.map((number) => ({ number }))),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`17TRACK ${path} answered HTTP ${response.status}`);
  const answer = (await response.json()) as Answer<T>;
  if (answer.code !== 0) throw new Error(`17TRACK ${path} answered code ${answer.code}`);
  return answer;
}

async function inBatches<T>(numbers: string[], run: (batch: string[]) => Promise<T[]>) {
  const out: T[] = [];
  for (let start = 0; start < numbers.length; start += TRACK17_BATCH) {
    if (start > 0) await pause(PAUSE_MS);
    out.push(...(await run(numbers.slice(start, start + TRACK17_BATCH))));
  }
  return out;
}

// ---- Which numbers are registered ----------------------------------------------------

const memory = new Map<string, { value: string; until: number }>();
const key = (number: string) => `track17:${number}`;

async function states(numbers: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (numbers.length === 0) return found;
  if (redis) {
    const values = await redis.mget<(string | null)[]>(...numbers.map(key));
    numbers.forEach((number, index) => {
      if (values[index]) found.set(number, values[index]!);
    });
    return found;
  }
  for (const number of numbers) {
    const entry = memory.get(key(number));
    if (entry && entry.until > Date.now()) found.set(number, entry.value);
  }
  return found;
}

async function remember(number: string, value: "registered" | "refused") {
  const ttl = value === "registered" ? REGISTERED_TTL_S : REFUSED_TTL_S;
  if (redis) await redis.set(key(number), value, { ex: ttl });
  else memory.set(key(number), { value, until: Date.now() + ttl * 1000 });
}

const NOTIFIED_TTL_S = 120 * 86_400;
const notifiedKey = (userId: string, parcelId: string) => `track17:notified:${userId}:${parcelId}`;

/** What the last notification of this parcel was about (trackingSignature), or null. */
export async function lastNotified(userId: string, parcelId: string): Promise<string | null> {
  if (redis) return (await redis.get<string>(notifiedKey(userId, parcelId))) ?? null;
  const entry = memory.get(notifiedKey(userId, parcelId));
  return entry && entry.until > Date.now() ? entry.value : null;
}

export async function rememberNotified(userId: string, parcelId: string, signature: string) {
  if (redis) await redis.set(notifiedKey(userId, parcelId), signature, { ex: NOTIFIED_TTL_S });
  else memory.set(notifiedKey(userId, parcelId), { value: signature, until: Date.now() + NOTIFIED_TTL_S * 1000 });
}

/** Tests: forgets what was registered in memory. */
export function resetTrack17Memory() {
  memory.clear();
}

/**
 * Registers the numbers 17TRACK doesn't track yet (each is charged once) and
 * returns the ones it tracks: newly or already registered. Refused ones are
 * left out for a week.
 */
export async function ensureRegistered(numbers: string[]): Promise<string[]> {
  const known = await states(numbers);
  const tracked = numbers.filter((number) => known.get(number) === "registered");
  const fresh = numbers.filter((number) => !known.has(number));
  if (fresh.length === 0) return tracked;
  if (track17Mode() === "demo") {
    for (const number of fresh) await remember(number, "registered");
    return [...tracked, ...fresh];
  }
  // Remembered after each batch: a later batch failing never has the earlier ones registered (and charged) again.
  await inBatches(fresh, async (batch) => {
    const answer = await call<{ number: string }>("register", batch);
    const results = [
      ...(answer.data?.accepted ?? []).map((item) => ({ number: item.number, ok: true })),
      ...(answer.data?.rejected ?? []).map((item) => ({ number: item.number, ok: item.error?.code === ALREADY_REGISTERED })),
    ];
    for (const result of results) {
      await remember(result.number, result.ok ? "registered" : "refused");
      if (result.ok) tracked.push(result.number);
    }
    return results;
  });
  return tracked;
}

/** What 17TRACK knows of these (registered) numbers, by number; numbers it has nothing on yet are missing. */
export async function trackInfo(numbers: string[], now = Date.now()): Promise<Map<string, Track17Item>> {
  const items = track17Mode() === "demo" ? numbers.map((number) => demoTrackItem(number, now)) : await inBatches(numbers, async (batch) => (await call<Track17Item>("gettrackinfo", batch)).data?.accepted ?? []);
  return new Map(items.map((item) => [item.number, item]));
}

// ---- Demo mode ----------------------------------------------------------------------

/**
 * A made-up answer, like lib/ai/mock.ts for the AI: a number ending in 0
 * has nothing yet, in 9 is delivered, in 8 has a problem; any other is in
 * transit. The event is at 8:00 on the day (the day before, earlier than
 * that): the same answer all day, as a carrier that didn't move.
 */
export function demoTrackItem(number: string, now: number): Track17Item {
  const last = number.slice(-1);
  const at = new Date(now);
  if (at.getHours() < 8) at.setDate(at.getDate() - 1);
  const day = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
  const time = "08:00:00";
  if (last === "0") return { number, track_info: { latest_status: { status: "NotFound", sub_status: "NotFound_Other" }, latest_event: null } };
  const [status, subStatus, description] =
    last === "9"
      ? ["Delivered", "Delivered_Other", "Delivered to the forwarder's warehouse"]
      : last === "8"
        ? ["Exception", "Exception_Other", "Customs inspection"]
        : ["InTransit", "InTransit_Arrival", "Arrived at the sorting centre"];
  return { number, track_info: { latest_status: { status, sub_status: subStatus }, latest_event: { time_raw: { date: day, time }, description, location: "Guangzhou" } } };
}
