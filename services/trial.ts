import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import { installIdHeader, type TrialResponse, type TrialState } from "@/lib/ai/schema";
import { authHeaders } from "./account";
import { httpClient } from "./httpClient";

// Anonymous per-install id the server counts free trial scans against. Kept in
// secure storage: on iOS the Keychain even survives reinstalling the app.

const INSTALL_ID_KEY = "install-id.v1";
let installId: Promise<string> | null = null;

function randomId() {
  // getRandomValues works outside secure contexts, unlike randomUUID.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function getInstallId() {
  installId ??= (async () => {
    const stored = await SecureStorage.getItem(INSTALL_ID_KEY).catch(() => null);
    if (stored) return stored;
    const created = randomId();
    await SecureStorage.setItem(INSTALL_ID_KEY, created).catch(() => undefined);
    return created;
  })();
  return installId;
}

/** Install id, plus the session when signed in so the trial is also counted per account. */
export async function installIdHeaders() {
  const [id, auth] = await Promise.all([getInstallId(), authHeaders().catch(() => ({}))]);
  return { [installIdHeader]: id, ...auth };
}

// ---- Trial state, shared by every screen that shows it -------------------

let state: TrialResponse | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export const trialStore = {
  get: () => state,

  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  async refresh() {
    try {
      state = await httpClient.get<TrialResponse>("/api/trial", { headers: await installIdHeaders() });
      emit();
    } catch {
      // Offline or older server: keep the last known state.
    }
  },

  /** Applies the count returned with an analysis, without another request. */
  update(trial: TrialState) {
    state = { enabled: true, ...trial };
    emit();
  },

  markExhausted() {
    if (state) state = { ...state, used: state.limit };
    emit();
  },
};
