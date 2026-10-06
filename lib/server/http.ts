import type { NextApiRequest, NextApiResponse } from "next";
import { installIdHeader, overrideHeaders, type ApiErrorBody, type ApiErrorCode } from "@/lib/ai/schema";

// Origins used by the Capacitor WebView (iOS, Android, live reload).
const capacitorOrigins = ["capacitor://localhost", "https://localhost", "http://localhost"];

const allowedOrigins = new Set([
  ...capacitorOrigins,
  ...(process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
]);

/** Applies CORS headers. Returns true when the request was a handled preflight. */
export function applyCors(req: NextApiRequest, res: NextApiResponse, methods: string[]) {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", [...methods, "OPTIONS"].join(", "));
    res.setHeader("Access-Control-Allow-Headers", ["Content-Type", installIdHeader, ...Object.values(overrideHeaders)].join(", "));
    res.setHeader("Access-Control-Max-Age", "86400");
  }

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}

export function sendError(
  res: NextApiResponse,
  status: number,
  code: ApiErrorCode,
  message: string,
) {
  const body: ApiErrorBody = { error: { code, message } };
  res.status(status).json(body);
}

export function clientIp(req: NextApiRequest) {
  const forwarded = req.headers["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
  return first?.trim() || req.socket.remoteAddress || "unknown";
}
