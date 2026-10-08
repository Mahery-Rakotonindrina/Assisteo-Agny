import type { PlanResponse } from "@/lib/plans";
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

  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  async refresh() {
    try {
      set(await httpClient.get<PlanResponse>("/api/plan", { headers: await installIdHeaders() }));
    } catch {
      // Offline or older server: keep the last known plan.
    }
  },

  /** Applies the counts returned with a scan or an answer, without another request. */
  setUsage(usage: Partial<PlanResponse["usage"]>) {
    if (state) set({ ...state, usage: { ...state.usage, ...usage } });
  },
};
