import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextApiRequest } from "next";

// Server-side Supabase access. The service role bypasses Row Level Security,
// so it is only used for tables clients may not touch (encrypted AI keys),
// and always scoped to the user id taken from a verified session token.

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

export const accountsEnabled = Boolean(url && serviceKey);

let admin: SupabaseClient | null = null;
export function supabaseAdmin() {
  if (!url || !serviceKey) throw new Error("Supabase is not configured on the server.");
  admin ??= createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

/** The signed-in user's id from "Authorization: Bearer <access token>", or null. */
export async function verifyUser(req: NextApiRequest): Promise<string | null> {
  const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token || !accountsEnabled) return null;
  // Verifies the JWT signature (locally with asymmetric keys, else via the Auth server).
  const { data, error } = await supabaseAdmin().auth.getClaims(token);
  const sub = data?.claims?.sub;
  return error || typeof sub !== "string" ? null : sub;
}
