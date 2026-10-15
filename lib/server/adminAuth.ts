import { timingSafeEqual } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { isAdminSession, OWNER, verifyAdminSession } from "./adminSession";
import { sessionEpoch, twoFactorState } from "./adminTwoFactor";
import { clientIp, sendError } from "./http";
import { rateLimit } from "./rateLimit";
import { planForEmail } from "./subscriptions";

/** Who is acting in /admin: the owner (admin token), an admin's e-mail, or "github" (the APK workflow). */
export type AdminActor = { id: string; owner: boolean };

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

/** An admin account: one with the "unlimited" plan running, which only the owner grants. */
export async function isAdminAccount(email: string) {
  return (await planForEmail(email).catch(() => null))?.plan === "unlimited";
}

/**
 * Shared gate of the admin routes: admin enabled, a rate limit against token
 * guessing (shared by every admin route), then "Authorization: Bearer …"
 * with a session from /api/admin/login. The bare ADMIN_TOKEN still works
 * while the second factor is off; once it is on, only with `machine` and the
 * CRON_SECRET in "X-Cron-Secret" (the GitHub workflow that announces a new
 * APK). An admin's session stops working as soon as their admin plan ends.
 * `ownerOnly`: refused to the other admins. Sends the error and returns
 * null when the request must stop, else who is acting.
 */
export async function guardAdmin(
  req: NextApiRequest,
  res: NextApiResponse,
  { machine = false, ownerOnly = false } = {},
): Promise<AdminActor | null> {
  if (!process.env.ADMIN_TOKEN) {
    sendError(res, 503, "unavailable", "Admin is disabled: set ADMIN_TOKEN on the server.");
    return null;
  }
  const limit = await rateLimit(`admin:${clientIp(req)}`, 60, 60_000);
  if (!limit.ok) {
    sendError(res, 429, "rate_limited", "Too many attempts.");
    return null;
  }
  const given = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  // Without its state, the second factor can't be skipped: refuse rather than guess.
  const state = await twoFactorState().catch(() => null);
  if (!state) {
    sendError(res, 503, "unavailable", "Admin settings are unreachable, try again.");
    return null;
  }
  let actor: AdminActor | null = null;
  if (given && isAdminSession(given)) {
    const id = verifyAdminSession(given, sessionEpoch(state));
    if (id === OWNER) actor = { id, owner: true };
    else if (id && (await isAdminAccount(id))) actor = { id, owner: false };
  } else if (given && isAdminToken(given)) {
    if (!state.enabled) actor = { id: OWNER, owner: true };
    else if (machine && same(req.headers["x-cron-secret"] as string | undefined, process.env.CRON_SECRET)) actor = { id: "github", owner: true };
  }
  if (!actor) {
    sendError(res, 401, "invalid_key", "Invalid admin token or expired session.");
    return null;
  }
  if (ownerOnly && !actor.owner) {
    sendError(res, 403, "owner_only", "Only the owner can do this.");
    return null;
  }
  res.setHeader("Cache-Control", "no-store");
  return actor;
}
