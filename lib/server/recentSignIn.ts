// "Supprimer mon compte" asks for a code sent to the account's e-mail, so a
// stolen or left-open session alone can't erase an account. The server needs
// no table for it: Supabase puts in the access token an "amr" list (how the
// session was opened, and when). Typing a fresh code in the app opens a new
// session whose amr says "otp" with the time of that very moment; a refresh
// of the token keeps it. The delete is accepted while that moment is recent.

/** How long a typed code lets the account be deleted. */
export const RECENT_CODE_MS = 5 * 60_000;
/** A little clock skew between Supabase and this server is forgiven. */
const SKEW_MS = 60_000;
/** The ways of signing in by a code sent by e-mail (not "password", "oauth" or "token_refresh"). */
const CODE_METHODS = new Set(["otp", "magiclink"]);

type Claims = { amr?: unknown };

/** When (ms) the session was last opened by an e-mail code, or null (a session without it, or an old token without "amr"). */
export function codeSignInAt(claims: Claims | null | undefined): number | null {
  if (!Array.isArray(claims?.amr)) return null;
  let latest: number | null = null;
  for (const entry of claims.amr as unknown[]) {
    const { method, timestamp } = (entry ?? {}) as { method?: unknown; timestamp?: unknown };
    if (typeof method !== "string" || !CODE_METHODS.has(method) || typeof timestamp !== "number" || !Number.isFinite(timestamp)) continue;
    const at = timestamp * 1000;
    if (latest === null || at > latest) latest = at;
  }
  return latest;
}

/** Whether the session was opened by an e-mail code within `maxAgeMs` before `now`. */
export function codeIsRecent(claims: Claims | null | undefined, now: number, maxAgeMs = RECENT_CODE_MS): boolean {
  const at = codeSignInAt(claims);
  return at !== null && now - at <= maxAgeMs && at - now <= SKEW_MS;
}
