import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextApiRequest } from "next";
import { emailConfirmed } from "./emailConfirmed";

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
  return (await verifyAccount(req))?.id ?? null;
}

/** True when Supabase Auth confirmed this user's e-mail. */
async function lookupConfirmed(userId: string) {
  const { data, error } = await supabaseAdmin().auth.admin.getUserById(userId);
  if (error) throw error;
  return Boolean(data.user?.email_confirmed_at);
}

/**
 * The signed-in user (id and e-mail) from the session token, or null. The
 * e-mail is null while it is not confirmed: no plan, seat or admin goes to an
 * address nobody proved to own.
 */
export async function verifyAccount(req: NextApiRequest): Promise<{ id: string; email: string | null } | null> {
  const verified = await verifiedClaims(req);
  if (!verified) return null;
  const { id, claims } = verified;
  const email = claims.email;
  if (typeof email !== "string" || !email) return { id, email: null };
  return { id, email: (await emailConfirmed(id, lookupConfirmed)) ? email.toLowerCase() : null };
}

/** The user id and the verified claims of the session token (e-mail, amr…), or null. */
export async function verifiedClaims(req: NextApiRequest): Promise<{ id: string; claims: { email?: unknown; amr?: unknown } } | null> {
  const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token || !accountsEnabled) return null;
  // Verifies the JWT signature (locally with asymmetric keys, else via the Auth server).
  const { data, error } = await supabaseAdmin().auth.getClaims(token);
  const claims = data?.claims;
  if (error || !claims || typeof claims.sub !== "string") return null;
  return { id: claims.sub, claims };
}
