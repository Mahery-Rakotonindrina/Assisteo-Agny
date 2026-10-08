import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { fxCurrencies, rateToAriary } from "@/lib/server/fx";
import { applyCors, clientIp, sendError } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";

export type FxResponse = { from: (typeof fxCurrencies)[number]; to: "MGA"; rate: number; updatedAt: string; source: "ExchangeRate-API" };

/** Today's rate from a currency (CNY, USD, EUR) to the ariary. */
export default async function handler(req: NextApiRequest, res: NextApiResponse<FxResponse | unknown>) {
  if (applyCors(req, res, ["GET"])) return;
  if (req.method !== "GET") return sendError(res, 405, "method_not_allowed", "Use GET.");
  const limit = await rateLimit(`fx:${clientIp(req)}`, 30, 60_000);
  if (!limit.ok) return sendError(res, 429, "rate_limited", "Too many requests.");
  const from = z.enum(fxCurrencies).safeParse(req.query.from);
  if (!from.success) return sendError(res, 400, "invalid_request", "Unknown currency.");

  const rate = await rateToAriary(from.data);
  if (!rate) return sendError(res, 503, "unavailable", "No exchange rate right now.");
  res.setHeader("Cache-Control", "public, max-age=3600");
  return res.status(200).json({ from: from.data, to: "MGA", ...rate, source: "ExchangeRate-API" } satisfies FxResponse);
}
