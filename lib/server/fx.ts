import { redis } from "./redis";

// Exchange rates to the ariary, for the parcels bought abroad. From the free
// open endpoint of ExchangeRate-API (updated daily, attribution required:
// the app credits it where the rate is shown), cached for a few hours.

export const fxCurrencies = ["CNY", "USD", "EUR"] as const;
export type FxCurrency = (typeof fxCurrencies)[number];
export type FxRate = { rate: number; updatedAt: string };

const TTL_S = 6 * 3600;
const memory = new Map<FxCurrency, FxRate & { expires: number }>();

async function fetchRate(from: FxCurrency): Promise<FxRate | null> {
  const response = await fetch(`https://open.er-api.com/v6/latest/${from}`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) return null;
  const data = (await response.json()) as { result?: string; rates?: Record<string, number>; time_last_update_utc?: string };
  const rate = data.rates?.MGA;
  if (data.result !== "success" || typeof rate !== "number" || !(rate > 0)) return null;
  return { rate, updatedAt: data.time_last_update_utc ? new Date(data.time_last_update_utc).toISOString() : new Date().toISOString() };
}

/** Ariary for one unit of the currency, or null when no rate can be had. */
export async function rateToAriary(from: FxCurrency): Promise<FxRate | null> {
  const key = `fx:${from}:MGA`;
  if (redis) {
    const cached = await redis.get<FxRate>(key).catch(() => null);
    if (cached) return cached;
  } else {
    const cached = memory.get(from);
    if (cached && cached.expires > Date.now()) return cached;
  }
  const fresh = await fetchRate(from).catch(() => null);
  if (!fresh) return null;
  if (redis) await redis.set(key, fresh, { ex: TTL_S }).catch(() => undefined);
  else memory.set(from, { ...fresh, expires: Date.now() + TTL_S * 1000 });
  return fresh;
}
