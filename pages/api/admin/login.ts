import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { isAdminToken } from "@/lib/server/adminAuth";
import { issueAdminSession } from "@/lib/server/adminSession";
import { checkSecondFactor, sessionEpoch, twoFactorState } from "@/lib/server/adminTwoFactor";
import { clientIp, sendError } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";

export type AdminLoginResponse = { session: string; expiresAt: number; twoFactor: boolean };

const LoginSchema = z.object({
  token: z.string().min(1).max(500),
  code: z.string().max(40).optional(),
});

/**
 * Signs in to /admin: the ADMIN_TOKEN, then a code from the authenticator app
 * when the second factor is on. Answers "second_factor" when the token is
 * right but the code is missing or wrong.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse<AdminLoginResponse | unknown>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendError(res, 405, "method_not_allowed", "Use POST.");
  }
  if (!process.env.ADMIN_TOKEN) return sendError(res, 503, "unavailable", "Admin is disabled: set ADMIN_TOKEN on the server.");
  // Ten tries per quarter of an hour: a 6-digit code can't be guessed.
  const limit = await rateLimit(`admin-login:${clientIp(req)}`, 10, 15 * 60_000);
  if (!limit.ok) {
    res.setHeader("Retry-After", String(limit.retryAfterS));
    return sendError(res, 429, "rate_limited", "Too many attempts.");
  }
  res.setHeader("Cache-Control", "no-store");

  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "invalid_request", "Send the admin token.");
  if (!isAdminToken(parsed.data.token.trim())) return sendError(res, 401, "invalid_key", "Invalid admin token.");

  const state = await twoFactorState();
  if (state.enabled) {
    const code = parsed.data.code?.trim();
    if (!code) return sendError(res, 401, "second_factor", "Enter the code from your authenticator app.");
    if (!(await checkSecondFactor(code))) return sendError(res, 401, "second_factor", "Wrong or already used code.");
  }
  const { session, expiresAt } = issueAdminSession(sessionEpoch(state));
  return res.status(200).json({ session, expiresAt, twoFactor: state.enabled } satisfies AdminLoginResponse);
}
