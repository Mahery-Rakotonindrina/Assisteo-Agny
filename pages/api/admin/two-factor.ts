import type { NextApiRequest, NextApiResponse } from "next";
import QRCode from "qrcode";
import { z } from "zod";
import { guardAdmin } from "@/lib/server/adminAuth";
import { issueAdminSession } from "@/lib/server/adminSession";
import {
  checkSecondFactor,
  confirmTwoFactor,
  disableTwoFactor,
  renewRecoveryCodes,
  sessionEpoch,
  startTwoFactor,
  twoFactorAvailable,
  twoFactorIsDurable,
  twoFactorState,
  type TwoFactorState,
} from "@/lib/server/adminTwoFactor";
import { sendError } from "@/lib/server/http";
import { otpauthUri } from "@/lib/server/totp";

export type AdminTwoFactorResponse = TwoFactorState & {
  available: boolean;
  durable: boolean;
  /** "start": the secret to type, and the same as a QR code (SVG data URL). */
  setup?: { secret: string; uri: string; qr: string };
  /** Shown once, when turned on or renewed. */
  recoveryCodes?: string[];
  /** Turning it on or off ends the sessions: the page keeps working with this one. */
  session?: { session: string; expiresAt: number };
};

const ActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("confirm"), code: z.string().min(1).max(40) }),
  z.object({ action: z.literal("disable"), code: z.string().min(1).max(40) }),
  z.object({ action: z.literal("recovery"), code: z.string().min(1).max(40) }),
]);

/** Admin-only: the second factor of /admin (authenticator app + recovery codes). */
export default async function handler(req: NextApiRequest, res: NextApiResponse<AdminTwoFactorResponse | unknown>) {
  if (!(await guardAdmin(req, res))) return;
  const reply = async (extra: Partial<AdminTwoFactorResponse> = {}) =>
    res.status(200).json({ ...(await twoFactorState()), available: twoFactorAvailable(), durable: twoFactorIsDurable, ...extra } satisfies AdminTwoFactorResponse);

  if (req.method === "GET") return reply();
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return sendError(res, 405, "method_not_allowed", "Use GET or POST.");
  }

  const parsed = ActionSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "invalid_request", "Unknown action.");
  const body = parsed.data;
  const state = await twoFactorState();

  if (body.action === "start") {
    if (state.enabled) return sendError(res, 409, "invalid_request", "Already on.");
    if (!twoFactorAvailable()) return sendError(res, 503, "unavailable", "Set API_KEYS_SECRET on the server first.");
    const secret = await startTwoFactor();
    const uri = otpauthUri(secret, "Assisteo Agny", "admin");
    const svg = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    return reply({ setup: { secret, uri, qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}` } });
  }

  if (body.action === "confirm") {
    if (state.enabled) return sendError(res, 409, "invalid_request", "Already on.");
    const recoveryCodes = await confirmTwoFactor(body.code);
    if (!recoveryCodes) return sendError(res, 400, "second_factor", "Wrong code, or the setup expired: start again.");
    return reply({ recoveryCodes, session: issueAdminSession(sessionEpoch(await twoFactorState())) });
  }

  // Turning it off or renewing the recovery codes asks for a code again.
  if (!(await checkSecondFactor(body.code))) return sendError(res, 400, "second_factor", "Wrong or already used code.");
  if (body.action === "disable") {
    await disableTwoFactor();
    return reply({ session: issueAdminSession(sessionEpoch(await twoFactorState())) });
  }
  return reply({ recoveryCodes: (await renewRecoveryCodes()) ?? [] });
}
