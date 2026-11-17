import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recentSearches, RECENT_SEARCHES_KEY } from "@/services/recentSearches";

describe("recent searches on the device", () => {
  let store: Record<string, string>;
  beforeEach(() => {
    store = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => void (store[key] = value),
      removeItem: (key: string) => void delete store[key],
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the searches, the latest first", () => {
    recentSearches.add("jirama");
    recentSearches.add("riz");
    expect(recentSearches.read()).toEqual(["riz", "jirama"]);
  });

  it("forgets everything when signing out", () => {
    recentSearches.add("jirama");
    expect(store[RECENT_SEARCHES_KEY]).toBeDefined();
    recentSearches.clear();
    expect(recentSearches.read()).toEqual([]);
    expect(store[RECENT_SEARCHES_KEY]).toBeUndefined();
  });

  it("does not fail when the storage is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    });
    expect(recentSearches.read()).toEqual([]);
    expect(() => recentSearches.add("riz")).not.toThrow();
    expect(() => recentSearches.clear()).not.toThrow();
  });
});
