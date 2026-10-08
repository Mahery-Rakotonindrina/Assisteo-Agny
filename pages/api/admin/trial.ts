import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { guardAdmin } from "@/lib/server/adminAuth";
import { sendError } from "@/lib/server/http";
import { getServerUsage, getTrialConfig, setTrialConfig, trialIsDurable, type TrialConfig } from "@/lib/server/trialStore";

export type AdminTrialResponse = TrialConfig & { durable: boolean; todayUsed: number };

const ConfigSchema = z.object({
  limit: z.number().int().min(0).max(1000),
  ipLimit: z.number().int().min(1).max(100_000),
  askLimit: z.number().int().min(0).max(1000),
  dailyLimit: z.number().int().min(0).max(1_000_000),
});

/** Admin-only: read or change the free trial limits at runtime. */
export default async function handler(req: NextApiRequest, res: NextApiResponse<AdminTrialResponse | unknown>) {
  if (!(await guardAdmin(req, res))) return;

  if (req.method === "GET") {
    const [config, usage] = await Promise.all([getTrialConfig(), getServerUsage()]);
    return res.status(200).json({ ...config, durable: trialIsDurable, todayUsed: usage.used } satisfies AdminTrialResponse);
  }

  if (req.method === "PUT") {
    const parsed = ConfigSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid settings.");
    await setTrialConfig(parsed.data);
    const usage = await getServerUsage();
    return res.status(200).json({ ...parsed.data, durable: trialIsDurable, todayUsed: usage.used } satisfies AdminTrialResponse);
  }

  res.setHeader("Allow", "GET, PUT");
  return sendError(res, 405, "method_not_allowed", "Use GET or PUT.");
}
