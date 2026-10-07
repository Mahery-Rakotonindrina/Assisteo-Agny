import type { NextApiRequest, NextApiResponse } from "next";
import { isAdmin } from "@/lib/server/adminAuth";
import { clientIp, sendError } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";
import { getRecentFeedback, getStats, getUniqueDevices, type DayStats, type FeedbackRecord } from "@/lib/server/stats";

export const STATS_DAYS = 14;

export type AdminStatsResponse = {
  /** Most recent day first. */
  days: DayStats[];
  /** Distinct devices over the whole period. */
  devices: number;
  feedback: FeedbackRecord[];
};

/** Admin-only: anonymous usage counters and the latest answer feedback. */
export default async function handler(req: NextApiRequest, res: NextApiResponse<AdminStatsResponse | unknown>) {
  if (!process.env.ADMIN_TOKEN) return sendError(res, 503, "unavailable", "Admin is disabled: set ADMIN_TOKEN on the server.");
  const limit = await rateLimit(`admin:${clientIp(req)}`, 20, 60_000);
  if (!limit.ok) return sendError(res, 429, "rate_limited", "Too many attempts.");
  if (!isAdmin(req)) return sendError(res, 401, "invalid_key", "Invalid admin token.");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendError(res, 405, "method_not_allowed", "Use GET.");
  }
  res.setHeader("Cache-Control", "no-store");
  const [days, devices, feedback] = await Promise.all([getStats(STATS_DAYS), getUniqueDevices(STATS_DAYS), getRecentFeedback(30)]);
  return res.status(200).json({ days, devices, feedback } satisfies AdminStatsResponse);
}
