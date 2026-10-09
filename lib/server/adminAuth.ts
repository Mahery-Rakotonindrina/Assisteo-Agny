import { timingSafeEqual } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { isAdminSession, verifyAdminSession } from "./adminSession";
import { sessionEpoch, twoFactorState } from "./adminTwoFactor";
import { clientIp, sendError } from "./http";
import { rateLimit } from "./rateLimit";

function same(given: string | undefined, expected: string | undefined) {
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** True when `given` is the ADMIN_TOKEN. */
export function isAdminToken(given: string | undefined) {
  return same(given, process.env.ADMIN_TOKEN);
}

/**
 * Shared gate of the admin routes: admin enabled, a rate limit against token
 * guessing (shared by every admin route), then "Authorization: Bearer …"
 * with a session from /api/admin/login. The bare ADMIN_TOKEN still works
 * while the second factor is off; once it is on, only with `machine` and the
 * CRON_SECRET in "X-Cron-Secret" (the GitHub workflow that announces a new
 * APK). Sends the error and returns false when the request must stop.
 */
export async function guardAdmin(req: NextApiRequest, res: NextApiResponse, { machine = false } = {}) {
  if (!process.env.ADMIN_TOKEN) {
    sendError(res, 503, "unavailable", "Admin is disabled: set ADMIN_TOKEN on the server.");
    return false;
  }
  const limit = await rateLimit(`admin:${clientIp(req)}`, 60, 60_000);
  if (!limit.ok) {
    sendError(res, 429, "rate_limited", "Too many attempts.");
    return false;
  }
  const given = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  // Without its state, the second factor can't be skipped: refuse rather than guess.
  const state = await twoFactorState().catch(() => null);
  if (!state) {
    sendError(res, 503, "unavailable", "Admin settings are unreachable, try again.");
    return false;
  }
  const allowed = given
    ? isAdminSession(given)
      ? verifyAdminSession(given, sessionEpoch(state))
      : isAdminToken(given) && (!state.enabled || (machine && same(req.headers["x-cron-secret"] as string | undefined, process.env.CRON_SECRET)))
    : false;
  if (!allowed) {
    sendError(res, 401, "invalid_key", "Invalid admin token or expired session.");
    return false;
  }
  res.setHeader("Cache-Control", "no-store");
  return true;
}
