import { hasFeature, type PlanResponse } from "@/lib/plans";
import { aiKeyStore } from "./aiKeyStore";
import { httpClient } from "./httpClient";
import { installIdHeaders } from "./trial";

// The user's plan, shared by every screen: fetched from /api/plan (which
// reads the account's subscription) and remembered for offline starts.

const CACHE_KEY = "plan.v1";

function readCache(): PlanResponse | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as PlanResponse) : null;
  } catch {
    return null;
  }
}

let state: PlanResponse | null = readCache();
// Checked with the server since the app opened (the cache may be stale).
let fresh = false;
const listeners = new Set<() => void>();

function set(next: PlanResponse) {
  state = next;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch {
    // Private mode: just not remembered.
  }
  listeners.forEach((listener) => listener());
}

export const planStore = {
  get: () => state,
  isFresh: () => fresh,

  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  async refresh() {
    try {
      const next = await httpClient.get<PlanResponse>("/api/plan", { headers: await installIdHeaders() });
      fresh = true;
      set(next);
    } catch {
      // Offline or older server: keep the last known plan.
    }
  },

  /** Applies the counts returned with a scan or an answer, without another request. */
  setUsage(usage: Partial<PlanResponse["usage"]>) {
    if (state) set({ ...state, usage: { ...state.usage, ...usage } });
  },

  /** The server refused a scan: none left on the trial or this month. */
  markScansUsedUp() {
    if (state) set({ ...state, usage: { ...state.usage, scans: Math.max(state.usage.scans, state.limits.scans) } });
  },
};

/** The user's own AI key, when their plan allows one (a subscription); else the app's AI is used. */
export async function usableAiKey() {
  const key = await aiKeyStore.get();
  return key && hasFeature(state?.plan ?? "free", "ownKey") ? key : null;
}
