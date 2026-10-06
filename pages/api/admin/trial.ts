import { timingSafeEqual } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { clientIp, sendError } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";
import { getTrialConfig, setTrialConfig, trialIsDurable, type TrialConfig } from "@/lib/server/trialStore";

export type AdminTrialResponse = TrialConfig & { durable: boolean };

const ConfigSchema = z.object({
  limit: z.number().int().min(0).max(1000),
  ipLimit: z.number().int().min(1).max(100_000),
});

function isAuthorized(req: NextApiRequest) {
  const expected = process.env.ADMIN_TOKEN;
  const given = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Admin-only: read or change the free trial limits at runtime. */
export default async function handler(req: NextApiRequest, res: NextApiResponse<AdminTrialResponse | unknown>) {
  if (!process.env.ADMIN_TOKEN) {
    return sendError(res, 503, "unavailable", "Admin is disabled: set ADMIN_TOKEN on the server.");
  }
  // Slow down token guessing.
  const limit = rateLimit(`admin:${clientIp(req)}`, 20, 60_000);
  if (!limit.ok) return sendError(res, 429, "rate_limited", "Too many attempts.");
  if (!isAuthorized(req)) return sendError(res, 401, "invalid_key", "Invalid admin token.");

  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    return res.status(200).json({ ...(await getTrialConfig()), durable: trialIsDurable } satisfies AdminTrialResponse);
  }

  if (req.method === "PUT") {
    const parsed = ConfigSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid settings.");
    await setTrialConfig(parsed.data);
    return res.status(200).json({ ...parsed.data, durable: trialIsDurable } satisfies AdminTrialResponse);
  }

  res.setHeader("Allow", "GET, PUT");
  return sendError(res, 405, "method_not_allowed", "Use GET or PUT.");
}
