import type { NextApiRequest, NextApiResponse } from "next";
import { activeProvider } from "@/lib/ai/provider";
import { InstallIdSchema, installIdHeader, type TrialResponse } from "@/lib/ai/schema";
import { applyCors, sendError } from "@/lib/server/http";
import { getTrialUsed, TRIAL_LIMIT } from "@/lib/server/trialStore";

/** How many free trial scans this install has used on the server's AI key. */
export default async function handler(req: NextApiRequest, res: NextApiResponse<TrialResponse | unknown>) {
  if (applyCors(req, res, ["GET"])) return;
  if (req.method !== "GET") return sendError(res, 405, "method_not_allowed", "Use GET.");

  const installId = InstallIdSchema.safeParse(req.headers[installIdHeader]);
  if (!installId.success) return sendError(res, 400, "invalid_request", "Missing install id.");

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    enabled: activeProvider !== "demo",
    limit: TRIAL_LIMIT,
    used: await getTrialUsed(installId.data),
  } satisfies TrialResponse);
}
