import { timingSafeEqual } from "node:crypto";
import type { NextApiRequest } from "next";

/**
 * Scheduled callers (Vercel Cron, the GitHub reminders workflow) send
 * "Authorization: Bearer <CRON_SECRET>". Without a secret configured, only
 * harmless routes may stay open: callers pass { required: true } otherwise.
 */
export function isCron(req: NextApiRequest, { required = false } = {}) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return !required;
  const given = Buffer.from(req.headers.authorization ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
