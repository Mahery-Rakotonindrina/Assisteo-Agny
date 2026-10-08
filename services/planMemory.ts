import { useSyncExternalStore } from "react";

// Small per-device memory for the plan moments: the plan last welcomed (so the
// welcome shows once), the last paid plan (to say when it has ended), and the
// end date whose reminder was dismissed. Browser storage: losing it only
// shows a moment again.

export const planMemoryKeys = {
  welcomed: "plan.welcomed.v1",
  lastPaid: "plan.lastPaid.v1",
  noticeDismissed: "plan.noticeDismissed.v1",
} as const;

type Key = (typeof planMemoryKeys)[keyof typeof planMemoryKeys];

const listeners = new Set<() => void>();

function read(key: Key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function rememberPlan(key: Key, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private mode: the moment may just show again.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePlanMemory(key: Key) {
  return useSyncExternalStore(subscribe, () => read(key), () => null);
}
