import { useCallback, useSyncExternalStore } from "react";

// A tip or a welcome card the user closed, remembered on the device. Read
// once mounted: dismissed (hidden) on the server and at hydration.

const listeners = new Set<() => void>();
// Private mode (no storage): remembered until the app closes.
const memory = new Set<string>();
const storageKey = (key: string) => `dismissed.${key}`;

function read(key: string) {
  if (memory.has(key)) return true;
  try {
    return localStorage.getItem(storageKey(key)) === "1";
  } catch {
    return false;
  }
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Whether the tip `key` was closed (true until read), and how to close it. */
export function useDismissed(key: string) {
  const dismissed = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => true,
  );
  const dismiss = useCallback(() => {
    memory.add(key);
    try {
      localStorage.setItem(storageKey(key), "1");
    } catch {
      // Kept in memory only.
    }
    listeners.forEach((listener) => listener());
  }, [key]);
  return [dismissed, dismiss] as const;
}
