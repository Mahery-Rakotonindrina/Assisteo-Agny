import { addRecent, readRecent } from "@/lib/globalSearch";

// The last five searches of "Rechercher", kept on this device only. Signing out
// clears them, like the rest of what the device keeps (lib/account/AccountProvider.tsx).

export const RECENT_SEARCHES_KEY = "search.recent";

export const recentSearches = {
  read(): string[] {
    try {
      return readRecent(localStorage.getItem(RECENT_SEARCHES_KEY));
    } catch {
      return [];
    }
  },

  /** Puts a search first and returns the list kept. */
  add(query: string): string[] {
    const next = addRecent(recentSearches.read(), query);
    try {
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
    } catch {
      // Private mode: the recent searches just aren't kept.
    }
    return next;
  },

  clear() {
    try {
      localStorage.removeItem(RECENT_SEARCHES_KEY);
    } catch {
      // Nothing was kept.
    }
  },
};
