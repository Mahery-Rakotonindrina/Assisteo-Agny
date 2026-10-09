import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Once the owner has signed in to /admin (token, then the code when the
// second factor is on), the page works with a signed session that expires:
// the token no longer travels with every request nor stays in the browser.
// Signed with a key derived from ADMIN_TOKEN and the second factor's last
// change, so changing either ends every session.

const PREFIX = "as1";
export const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000;

function sign(body: string, epoch: string) {
  const key = createHmac("sha256", process.env.ADMIN_TOKEN ?? "")
    .update(`admin-session:${epoch}`)
    .digest();
  return createHmac("sha256", key).update(body).digest("base64url");
}

export function isAdminSession(value: string) {
  return value.startsWith(`${PREFIX}.`);
}

export function issueAdminSession(epoch: string, now = Date.now()) {
  const expiresAt = now + ADMIN_SESSION_MS;
  const body = `${PREFIX}.${expiresAt}.${randomBytes(9).toString("base64url")}`;
  return { session: `${body}.${sign(body, epoch)}`, expiresAt };
}

export function verifyAdminSession(value: string, epoch: string, now = Date.now()) {
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) return false;
  const expected = Buffer.from(sign(parts.slice(0, 3).join("."), epoch));
  const given = Buffer.from(parts[3]);
  return given.length === expected.length && timingSafeEqual(given, expected) && Number(parts[1]) > now;
}
