import type { NextApiRequest, NextApiResponse } from "next";
import { activeModel, activeProvider } from "@/lib/ai/provider";
import type { HealthResponse } from "@/lib/ai/schema";
import { applyCors, sendError } from "@/lib/server/http";

export default function handler(req: NextApiRequest, res: NextApiResponse<HealthResponse | unknown>) {
  if (applyCors(req, res, ["GET"])) return;
  if (req.method !== "GET") return sendError(res, 405, "method_not_allowed", "Use GET.");

  res.status(200).json({
    status: "ok",
    ai: activeProvider === "demo" ? "demo" : "live",
    provider: activeProvider,
    model: activeModel,
  } satisfies HealthResponse);
}
