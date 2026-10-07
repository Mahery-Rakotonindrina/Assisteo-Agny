import { timingSafeEqual } from "node:crypto";
import type { NextApiRequest } from "next";

/** True when the request carries "Authorization: Bearer <ADMIN_TOKEN>". */
export function isAdmin(req: NextApiRequest) {
  const expected = process.env.ADMIN_TOKEN;
  const given = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
