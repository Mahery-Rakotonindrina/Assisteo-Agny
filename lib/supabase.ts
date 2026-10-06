import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Browser/app-side Supabase client. The session (refresh token included) is
// kept in the phone's secure storage; on the web it falls back to localStorage.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/** False until the Supabase integration is configured for this build. */
export const accountsAvailable = Boolean(url && anonKey);

const secureStorage = {
  getItem: (key: string) => SecureStorage.getItem(key).catch(() => null),
  setItem: (key: string, value: string) => SecureStorage.setItem(key, value).catch(() => undefined),
  removeItem: (key: string) => SecureStorage.removeItem(key).catch(() => undefined),
};

let client: SupabaseClient | null = null;

export function supabase() {
  if (!url || !anonKey) throw new Error("Accounts are not configured for this build.");
  client ??= createClient(url, anonKey, {
    auth: {
      storage: secureStorage,
      storageKey: "assisteo-auth",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return client;
}
