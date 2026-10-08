import type { NextApiRequest, NextApiResponse } from "next";
import { guardAdmin } from "@/lib/server/adminAuth";
import { sendError } from "@/lib/server/http";
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
  if (!(await guardAdmin(req, res))) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendError(res, 405, "method_not_allowed", "Use GET.");
  }
  const [days, devices, feedback] = await Promise.all([getStats(STATS_DAYS), getUniqueDevices(STATS_DAYS), getRecentFeedback(30)]);
  return res.status(200).json({ days, devices, feedback } satisfies AdminStatsResponse);
}
