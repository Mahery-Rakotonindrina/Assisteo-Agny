import type { Session } from "@supabase/supabase-js";
import { accountsAvailable, supabase } from "@/lib/supabase";
import { httpClient } from "./httpClient";

// Passwordless sign-in: the user receives a one-time code by e-mail and types
// it in the app. Works the same on the web and in the Capacitor app (no
// redirect back into the app is needed, unlike magic links).

export type SignInError = "invalid_email" | "rate_limited" | "invalid_code" | "expired_code" | "network" | "unavailable";

function toError(message: string | undefined, status?: number): SignInError {
  const text = (message ?? "").toLowerCase();
  if (status === 429 || text.includes("rate limit") || text.includes("security purposes")) return "rate_limited";
  if (text.includes("expired")) return "expired_code";
  if (text.includes("token") || text.includes("otp") || text.includes("invalid")) return "invalid_code";
  if (text.includes("email")) return "invalid_email";
  if (text.includes("fetch") || text.includes("network")) return "network";
  return "unavailable";
}

export async function sendSignInCode(email: string): Promise<SignInError | null> {
  if (!accountsAvailable) return "unavailable";
  const { error } = await supabase().auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  return error ? toError(error.message, error.status) : null;
}

export async function verifySignInCode(email: string, code: string): Promise<SignInError | null> {
  if (!accountsAvailable) return "unavailable";
  const { error } = await supabase().auth.verifyOtp({ email, token: code, type: "email" });
  return error ? (toError(error.message, error.status) === "invalid_email" ? "invalid_code" : toError(error.message, error.status)) : null;
}

export async function getSession(): Promise<Session | null> {
  if (!accountsAvailable) return null;
  const { data } = await supabase().auth.getSession();
  return data.session;
}

/** Calls back with the current session now and on every sign-in, refresh and sign-out. */
export function onSessionChange(listener: (session: Session | null) => void) {
  if (!accountsAvailable) {
    listener(null);
    return () => undefined;
  }
  void getSession().then(listener);
  const { data } = supabase().auth.onAuthStateChange((_event, session) => listener(session));
  return () => data.subscription.unsubscribe();
}

export async function signOutAccount() {
  if (!accountsAvailable) return;
  // "local" ends this device's session only, not the user's other devices.
  await supabase().auth.signOut({ scope: "local" });
}

/** Authorization header for our own API routes, or none when signed out. */
export async function authHeaders(): Promise<Record<string, string>> {
  const session = await getSession();
  return session ? { Authorization: `Bearer ${session.access_token}` } : {};
}

/** Deletes the account and everything it holds on the server. Irreversible. */
export async function deleteAccountOnServer() {
  await httpClient.delete<void>("/api/account", { headers: await authHeaders() });
}
