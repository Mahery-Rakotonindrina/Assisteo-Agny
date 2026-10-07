import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { categories, scanModes } from "@/lib/ai/schema";
import { applyCors, clientIp, sendError } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";
import { recordFeedback, track } from "@/lib/server/stats";

export const feedbackReasons = ["wrong_subject", "wrong_info", "other"] as const;

export const FeedbackRequestSchema = z.object({
  vote: z.enum(["up", "down"]),
  reason: z.enum(feedbackReasons).optional(),
  category: z.enum(categories),
  mode: z.enum(scanModes),
  model: z.string().max(80),
  confidence: z.number().min(0).max(1),
  title: z.string().max(120),
});

export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>;

/** "Was this answer right?" — anonymous: no photo, no account, no device id. */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (applyCors(req, res, ["POST"])) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return sendError(res, 405, "method_not_allowed", "Use POST.");
  }
  const limit = await rateLimit(`feedback:${clientIp(req)}`, 20, 60_000);
  if (!limit.ok) return sendError(res, 429, "rate_limited", "Too many requests.");

  const parsed = FeedbackRequestSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid feedback.");
  const feedback = parsed.data;

  await Promise.all([
    track({ type: "feedback", vote: feedback.vote, category: feedback.category }),
    recordFeedback({ ...feedback, title: feedback.title.slice(0, 80), at: Date.now() }),
  ]);
  return res.status(204).end();
}
