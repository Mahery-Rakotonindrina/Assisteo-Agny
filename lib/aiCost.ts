import type { PlanOffer } from "./plans";

// What the server's AI key costs: tokens counted per kind of call and model
// (lib/server/stats.ts, fields "ai:<kind>:<model>:calls|in|out"), priced per
// million tokens. Prices are set in /admin: the defaults are indicative.

export const aiKinds = ["scan", "deep", "question"] as const;
export type AiKind = (typeof aiKinds)[number];

/** US dollars per million tokens, for the models whose name contains `match`. */
export type AiPrice = { match: string; inputUsd: number; outputUsd: number };

export const defaultAiPrices: AiPrice[] = [
  { match: "flash-lite", inputUsd: 0.1, outputUsd: 0.4 },
  { match: "flash", inputUsd: 0.3, outputUsd: 2.5 },
  { match: "pro", inputUsd: 1.25, outputUsd: 10 },
  { match: "claude-haiku", inputUsd: 1, outputUsd: 5 },
  { match: "claude-sonnet", inputUsd: 3, outputUsd: 15 },
  { match: "claude-opus", inputUsd: 5, outputUsd: 25 },
];

export type AiUsageRow = { kind: AiKind; model: string; calls: number; inputTokens: number; outputTokens: number };

/** The usage rows in day counters (summed over the days given). */
export function usageRows(counters: Array<Record<string, number>>): AiUsageRow[] {
  const rows = new Map<string, AiUsageRow>();
  for (const day of counters) {
    for (const [field, value] of Object.entries(day)) {
      const match = field.match(/^ai:(scan|deep|question):(.+):(calls|in|out)$/);
      if (!match) continue;
      const [, kind, model, part] = match as unknown as [string, AiKind, string, "calls" | "in" | "out"];
      const key = `${kind}|${model}`;
      const row = rows.get(key) ?? { kind, model, calls: 0, inputTokens: 0, outputTokens: 0 };
      if (part === "calls") row.calls += Number(value);
      else if (part === "in") row.inputTokens += Number(value);
      else row.outputTokens += Number(value);
      rows.set(key, row);
    }
  }
  return [...rows.values()].sort((a, b) => aiKinds.indexOf(a.kind) - aiKinds.indexOf(b.kind) || b.calls - a.calls);
}

/** The price of a model: the longest `match` its name contains ("flash-lite" before "flash"). */
export function priceFor(model: string, prices: AiPrice[]): AiPrice | null {
  const name = model.toLowerCase();
  return (
    prices
      .filter((price) => price.match.trim() && name.includes(price.match.trim().toLowerCase()))
      .sort((a, b) => b.match.trim().length - a.match.trim().length)[0] ?? null
  );
}

export function rowCostUsd(row: AiUsageRow, price: AiPrice) {
  return (row.inputTokens * price.inputUsd + row.outputTokens * price.outputUsd) / 1_000_000;
}

export type KindCost = { kind: AiKind; calls: number; usd: number; usdPerCall: number; unpriced: string[] };

/** Per kind of call: how many, what they cost, and the models without a price. */
export function costsByKind(rows: AiUsageRow[], prices: AiPrice[]): KindCost[] {
  return aiKinds.map((kind) => {
    const ofKind = rows.filter((row) => row.kind === kind);
    const calls = ofKind.reduce((sum, row) => sum + row.calls, 0);
    let usd = 0;
    const unpriced: string[] = [];
    for (const row of ofKind) {
      const price = priceFor(row.model, prices);
      if (price) usd += rowCostUsd(row, price);
      else unpriced.push(row.model);
    }
    return { kind, calls, usd, usdPerCall: calls ? usd / calls : 0, unpriced };
  });
}

/**
 * The most the AI can cost for a plan used to the full in a month: every
 * scan, every deep analysis, every question of every day (30 days).
 */
export function planWorstCaseUsd(offer: PlanOffer, costs: KindCost[]) {
  const per = (kind: AiKind) => costs.find((cost) => cost.kind === kind)?.usdPerCall ?? 0;
  return offer.scans * per("scan") + offer.deepPerMonth * per("deep") + offer.questionsPerDay * 30 * per("question");
}
