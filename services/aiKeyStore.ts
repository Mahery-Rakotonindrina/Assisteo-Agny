import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import { AiOverrideSchema, type AiOverride } from "@/lib/ai/schema";

// The user's own AI key. Native apps keep it in the Keychain (iOS) or the
// Keystore-backed storage (Android); browsers fall back to localStorage.

const STORAGE_KEY = "ai-override.v2";

/** The key itself plus which provider preset the user picked (for display). */
export type SavedKey = AiOverride & { presetId: string };

let cache: SavedKey | null | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

function parse(raw: string | null): SavedKey | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    const parsed = AiOverrideSchema.safeParse(data);
    if (!parsed.success) return null;
    return { ...parsed.data, presetId: typeof data.presetId === "string" ? data.presetId : parsed.data.provider };
  } catch {
    return null;
  }
}

export const aiKeyStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  async get(): Promise<SavedKey | null> {
    if (cache !== undefined) return cache;
    // v1 keys (Claude/Gemini only) are still valid under the new schema.
    const raw =
      (await SecureStorage.getItem(STORAGE_KEY).catch(() => null)) ??
      (await SecureStorage.getItem("ai-override.v1").catch(() => null));
    cache = parse(raw);
    return cache;
  },

  async save(key: SavedKey) {
    await SecureStorage.setItem(STORAGE_KEY, JSON.stringify(key));
    await SecureStorage.removeItem("ai-override.v1").catch(() => undefined);
    cache = key;
    emit();
  },

  async clear() {
    await Promise.all([
      SecureStorage.removeItem(STORAGE_KEY).catch(() => undefined),
      SecureStorage.removeItem("ai-override.v1").catch(() => undefined),
    ]);
    cache = null;
    emit();
  },
};

/** Hides all but the edges of a key, for display. */
export function maskKey(key: string) {
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
