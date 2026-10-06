import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import { AiOverrideSchema, type AiOverride } from "@/lib/ai/schema";

// The user's own AI key. Native apps keep it in the Keychain (iOS) or the
// Keystore-backed storage (Android); browsers fall back to localStorage.

const STORAGE_KEY = "ai-override.v1";

let cache: AiOverride | null | undefined;
const listeners = new Set<() => void>();

export const aiKeyStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  async get(): Promise<AiOverride | null> {
    if (cache !== undefined) return cache;
    try {
      const raw = await SecureStorage.getItem(STORAGE_KEY);
      const parsed = raw ? AiOverrideSchema.safeParse(JSON.parse(raw)) : null;
      cache = parsed?.success ? parsed.data : null;
    } catch {
      cache = null;
    }
    return cache;
  },

  async save(override: AiOverride) {
    await SecureStorage.setItem(STORAGE_KEY, JSON.stringify(override));
    cache = override;
    listeners.forEach((listener) => listener());
  },

  async clear() {
    await SecureStorage.removeItem(STORAGE_KEY).catch(() => undefined);
    cache = null;
    listeners.forEach((listener) => listener());
  },
};

/** Hides all but the last characters, for display. */
export function maskKey(key: string) {
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
