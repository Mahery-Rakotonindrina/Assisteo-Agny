import { describe, expect, it, vi } from "vitest";
import { locales } from "@/i18n.config";
import { effectiveLocale, effectiveLocaleFor, localeAllowed } from "@/lib/localeAccess";
import { formatAriary, formatBytes, formatCompact, formatDate, formatDecimal, formatNumber, formatReminder, formatTag, numberTag } from "@/lib/format";
import { hasFeature } from "@/lib/plans";

const none = () => false;
const all = () => true;

describe("language access", () => {
  it("lists Malagasy among the app's languages", () => {
    expect(locales).toContain("mg");
  });

  it("falls back to French when the malagasy feature is missing", () => {
    expect(effectiveLocale("mg", none)).toBe("fr");
    expect(effectiveLocale("mg", all)).toBe("mg");
    expect(effectiveLocale("en", none)).toBe("en");
    expect(localeAllowed("mg", none)).toBe(false);
    expect(localeAllowed("fr", none)).toBe(true);
  });

  it("follows the plan the app knows", () => {
    expect(effectiveLocaleFor("mg", null)).toBe("fr");
    expect(effectiveLocaleFor("mg", { plan: "pro", features: ["reminders"] })).toBe("fr");
    expect(effectiveLocaleFor("mg", { plan: "free", features: ["malagasy"] })).toBe("mg");
    // Older server without a list: the built-in ladder (Admin only).
    expect(effectiveLocaleFor("mg", { plan: "premium" } as never)).toBe("fr");
    expect(effectiveLocaleFor("mg", { plan: "unlimited" } as never)).toBe("mg");
    expect(hasFeature("pro", "malagasy")).toBe(false);
  });
});

describe("formatting in Malagasy", () => {
  it("never throws, whatever the engine knows", () => {
    const at = new Date(2026, 10, 16, 14, 30).getTime();
    for (const locale of locales) {
      expect(formatDate(at, locale)).toBeTruthy();
      expect(formatAriary(245000, locale)).toMatch(/245.*000 Ar$/);
      expect(formatNumber(1234, locale)).toMatch(/1.234|1234/);
    }
    expect(formatReminder(at + 86_400_000, at, "mg")).toContain("rahampitso");
  });

  it("writes numbers and amounts as in French, never the English way", () => {
    expect(numberTag("mg")).toBe("fr-FR");
    expect(formatAriary(245000, "mg")).toBe(formatAriary(245000, "fr"));
    expect(formatDecimal(221.45, "mg")).toBe(formatDecimal(221.45, "fr"));
    expect(formatDecimal(221.45, "mg")).toContain(",");
    expect(formatCompact(1200, "mg")).toBe(formatCompact(1200, "fr"));
    expect(formatNumber(1234567, "mg")).toBe(formatNumber(1234567, "fr"));
    expect(formatBytes(3 * 1024 * 1024, "mg")).toBe(formatBytes(3 * 1024 * 1024, "fr"));
    expect(formatAriary(245000, "en")).toContain("245,000");
  });

  it("uses a French tag when the engine has no Malagasy data", async () => {
    const original = Intl.DateTimeFormat.supportedLocalesOf;
    Intl.DateTimeFormat.supportedLocalesOf = (tags) => [tags].flat().map(String).filter((tag) => !tag.startsWith("mg"));
    try {
      vi.resetModules();
      const fresh = await import("@/lib/format");
      expect(fresh.formatTag("mg")).toBe("fr-FR");
      expect(fresh.formatTag("en")).toBe("en-GB");
      expect(fresh.formatDate(0, "mg")).toBe(fresh.formatDate(0, "fr"));
    } finally {
      Intl.DateTimeFormat.supportedLocalesOf = original;
    }
  });
});

describe("dictionaries", () => {
  it("loads Malagasy on demand and tells the subscribers; French and English are there at once", async () => {
    vi.resetModules();
    const dictionaries = await import("@/lib/i18n/dictionaries");
    expect(dictionaries.loadedDictionary("fr")).toBeDefined();
    expect(dictionaries.loadedDictionary("en")).toBeDefined();
    expect(dictionaries.loadedDictionary("mg")).toBeUndefined();
    const told = new Promise<void>((resolve) => dictionaries.subscribeDictionaries(resolve));
    dictionaries.loadDictionary("mg");
    await told;
    expect(dictionaries.loadedDictionary("mg")?.nav.history).toBeTruthy();
  });
});
