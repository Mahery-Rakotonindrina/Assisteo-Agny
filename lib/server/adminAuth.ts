import { timingSafeEqual } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { clientIp, sendError } from "./http";
import { rateLimit } from "./rateLimit";

/** True when the request carries "Authorization: Bearer <ADMIN_TOKEN>". */
export function isAdmin(req: NextApiRequest) {
  const expected = process.env.ADMIN_TOKEN;
  const given = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Shared gate of the admin routes: admin enabled, a rate limit against token
 * guessing (shared by every admin route), then the token. Sends the error
 * and returns false when the request must stop.
 */
export async function guardAdmin(req: NextApiRequest, res: NextApiResponse) {
  if (!process.env.ADMIN_TOKEN) {
    sendError(res, 503, "unavailable", "Admin is disabled: set ADMIN_TOKEN on the server.");
    return false;
  }
  const limit = await rateLimit(`admin:${clientIp(req)}`, 60, 60_000);
  if (!limit.ok) {
    sendError(res, 429, "rate_limited", "Too many attempts.");
    return false;
  }
  if (!isAdmin(req)) {
    sendError(res, 401, "invalid_key", "Invalid admin token.");
    return false;
  }
  res.setHeader("Cache-Control", "no-store");
  return true;
}
