import type { NextApiRequest, NextApiResponse } from "next";
import { toVerifyFailure } from "@/lib/ai/errors";
import { listModels } from "@/lib/ai/provider";
import { ListModelsRequestSchema, type ListModelsResponse } from "@/lib/ai/schema";
import { applyCors, clientIp, sendError } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";

/** Lists the models a user's key can use, so the app doesn't hard-code names that go stale. */
export default async function handler(req: NextApiRequest, res: NextApiResponse<ListModelsResponse | unknown>) {
  if (applyCors(req, res, ["POST"])) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return sendError(res, 405, "method_not_allowed", "Use POST.");
  }

  const limit = await rateLimit(`models:${clientIp(req)}`, 15, 60_000);
  if (!limit.ok) return sendError(res, 429, "rate_limited", "Too many requests, try again in a moment.");

  const parsed = ListModelsRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(200).json({ ok: false, reason: "bad_url" } satisfies ListModelsResponse);

  try {
    return res.status(200).json({ ok: true, models: await listModels(parsed.data) } satisfies ListModelsResponse);
  } catch (error) {
    return res.status(200).json({ ok: false, reason: toVerifyFailure(error).reason } satisfies ListModelsResponse);
  }
}
