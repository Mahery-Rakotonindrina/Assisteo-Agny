import type { NextApiRequest, NextApiResponse } from "next";
import { applyCors, clientIp, sendError } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";
import { accountsEnabled, supabaseAdmin, verifyUser } from "@/lib/server/supabaseAdmin";

// Deletes the signed-in user's account for good: photos first (storage is not
// covered by the database cascade), then the auth user, which cascades to
// analyses, settings and the encrypted AI key.

const BUCKET = "scans";
const PAGE = 1000;

/** Every object path under "<userId>/", one scan folder at a time. */
async function listUserFiles(userId: string) {
  const storage = supabaseAdmin().storage.from(BUCKET);
  const paths: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data: folders, error } = await storage.list(userId, { limit: PAGE, offset });
    if (error) throw error;
    for (const folder of folders) {
      // Folders have no id; a stray file directly under the user folder does.
      if (folder.id) {
        paths.push(`${userId}/${folder.name}`);
        continue;
      }
      const { data: files, error: filesError } = await storage.list(`${userId}/${folder.name}`, { limit: PAGE });
      if (filesError) throw filesError;
      paths.push(...files.map((file) => `${userId}/${folder.name}/${file.name}`));
    }
    if (folders.length < PAGE) return paths;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (applyCors(req, res, ["DELETE"])) return;
  if (req.method !== "DELETE") {
    res.setHeader("Allow", "DELETE, OPTIONS");
    return sendError(res, 405, "method_not_allowed", "Use DELETE.");
  }
  if (!accountsEnabled) return sendError(res, 503, "unavailable", "Accounts are not configured.");

  const limit = await rateLimit(`account-delete:${clientIp(req)}`, 5, 60_000);
  if (!limit.ok) return sendError(res, 429, "rate_limited", "Too many requests.");

  const userId = await verifyUser(req);
  if (!userId) return sendError(res, 401, "invalid_key", "Sign in again.");

  res.setHeader("Cache-Control", "no-store");
  try {
    const paths = await listUserFiles(userId);
    const storage = supabaseAdmin().storage.from(BUCKET);
    for (let index = 0; index < paths.length; index += PAGE) {
      const { error } = await storage.remove(paths.slice(index, index + PAGE));
      if (error) throw error;
    }
    const { error } = await supabaseAdmin().auth.admin.deleteUser(userId);
    if (error) throw error;
  } catch {
    return sendError(res, 502, "upstream_error", "Couldn't delete the account.");
  }
  return res.status(204).end();
}
