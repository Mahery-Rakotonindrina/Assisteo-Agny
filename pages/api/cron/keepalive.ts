import { timingSafeEqual } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { sendError } from "@/lib/server/http";
import { accountsEnabled, supabaseAdmin } from "@/lib/server/supabaseAdmin";
import { getTrialConfig } from "@/lib/server/trialStore";

// Called once a day by Vercel Cron (vercel.json). Free Supabase projects are
// paused after a week without activity: a tiny query keeps the database awake
// even when nobody has used the app for days. Redis is touched too.

function authorized(req: NextApiRequest) {
  const secret = process.env.CRON_SECRET;
  // Without a secret the route only runs harmless reads, so it stays open.
  if (!secret) return true;
  const given = Buffer.from(req.headers.authorization ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return sendError(res, 405, "method_not_allowed", "Use GET.");
  if (!authorized(req)) return sendError(res, 401, "invalid_key", "Unauthorized.");
  res.setHeader("Cache-Control", "no-store");

  const result: Record<string, "ok" | "skipped" | "error"> = { database: "skipped", redis: "ok" };
  if (accountsEnabled) {
    const { error } = await supabaseAdmin().from("analyses").select("id", { head: true, count: "exact" }).limit(1);
    result.database = error ? "error" : "ok";
  }
  try {
    await getTrialConfig();
  } catch {
    result.redis = "error";
  }

  const failed = Object.values(result).includes("error");
  return res.status(failed ? 502 : 200).json(result);
}
