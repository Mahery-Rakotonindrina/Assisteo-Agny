import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { AiOverrideSchema } from "@/lib/ai/schema";
import { applyCors, clientIp, sendError } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";
import { open, seal } from "@/lib/server/secretBox";
import { accountsEnabled, supabaseAdmin, verifyUser } from "@/lib/server/supabaseAdmin";

// Syncs the user's own AI key across their devices. The key is encrypted
// before it reaches the database and only ever returned to its owner.

const SavedKeySchema = z.object({
  key: AiOverrideSchema,
  presetId: z.string().min(1).max(40),
  updatedAt: z.number().int().positive(),
});

export type AccountAiKey = z.infer<typeof SavedKeySchema>;

export default async function handler(req: NextApiRequest, res: NextApiResponse<{ key: AccountAiKey | null } | unknown>) {
  if (applyCors(req, res, ["GET", "PUT", "DELETE"])) return;
  if (!accountsEnabled) return sendError(res, 503, "unavailable", "Accounts are not configured.");

  const limit = await rateLimit(`account-key:${clientIp(req)}`, 30, 60_000);
  if (!limit.ok) return sendError(res, 429, "rate_limited", "Too many requests.");

  const userId = await verifyUser(req);
  if (!userId) return sendError(res, 401, "invalid_key", "Sign in again.");

  res.setHeader("Cache-Control", "no-store");
  const table = supabaseAdmin().from("user_ai_keys");

  if (req.method === "GET") {
    const { data, error } = await table.select("preset_id, ciphertext, updated_at").eq("user_id", userId).maybeSingle();
    if (error) return sendError(res, 502, "upstream_error", "Couldn't read the key.");
    if (!data) return res.status(200).json({ key: null });
    try {
      const key = AiOverrideSchema.parse(JSON.parse(open(data.ciphertext)));
      return res.status(200).json({ key: { key, presetId: data.preset_id, updatedAt: new Date(data.updated_at).getTime() } });
    } catch {
      // Unreadable (rotated secret, corrupted row): treat as no key.
      return res.status(200).json({ key: null });
    }
  }

  if (req.method === "PUT") {
    const parsed = SavedKeySchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "invalid_request", "Invalid key.");
    const { key, presetId, updatedAt } = parsed.data;
    const { error } = await table.upsert({
      user_id: userId,
      preset_id: presetId,
      ciphertext: seal(JSON.stringify(key)),
      updated_at: new Date(updatedAt).toISOString(),
    });
    if (error) return sendError(res, 502, "upstream_error", "Couldn't save the key.");
    return res.status(204).end();
  }

  if (req.method === "DELETE") {
    const { error } = await table.delete().eq("user_id", userId);
    if (error) return sendError(res, 502, "upstream_error", "Couldn't delete the key.");
    return res.status(204).end();
  }

  res.setHeader("Allow", "GET, PUT, DELETE, OPTIONS");
  return sendError(res, 405, "method_not_allowed", "Use GET, PUT or DELETE.");
}
