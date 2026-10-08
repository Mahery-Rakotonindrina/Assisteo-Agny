import type { NextApiRequest, NextApiResponse } from "next";
import { usageRows, type AiPrice, type AiUsageRow } from "@/lib/aiCost";
import { guardAdmin } from "@/lib/server/adminAuth";
import { AiPricesSchema, getAiPrices, setAiPrices } from "@/lib/server/aiPrices";
import { rateToAriary } from "@/lib/server/fx";
import { sendError } from "@/lib/server/http";
import { getStats } from "@/lib/server/stats";

export const AI_COST_DAYS = 30;

export type AdminAiCostResponse = {
  days: number;
  rows: AiUsageRow[];
  prices: AiPrice[];
  /** Ariary for one dollar today, or null if unavailable. */
  usdToMga: number | null;
};

/** Admin-only: the tokens the server's AI key used lately, and the prices to cost them (GET, PUT prices). */
export default async function handler(req: NextApiRequest, res: NextApiResponse<AdminAiCostResponse | unknown>) {
  if (!(await guardAdmin(req, res))) return;

  if (req.method === "PUT") {
    const parsed = AiPricesSchema.safeParse(req.body?.prices);
    if (!parsed.success) return sendError(res, 400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid prices.");
    await setAiPrices(parsed.data);
  } else if (req.method !== "GET") {
    res.setHeader("Allow", "GET, PUT");
    return sendError(res, 405, "method_not_allowed", "Use GET or PUT.");
  }

  const [days, prices, usd] = await Promise.all([getStats(AI_COST_DAYS), getAiPrices(), rateToAriary("USD")]);
  return res.status(200).json({
    days: AI_COST_DAYS,
    rows: usageRows(days.map((day) => day.counters)),
    prices,
    usdToMga: usd?.rate ?? null,
  } satisfies AdminAiCostResponse);
}
