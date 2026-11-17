import { describe, expect, it } from "vitest";
import { legalDocuments } from "@/lib/legal";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import mg from "@/locales/mg.json";
import { protectedTerms, problems } from "../../scripts/lib/localeParts.mjs";

function keys(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value) || value === null || typeof value !== "object") return [prefix];
  return Object.entries(value).flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key));
}

function placeholders(text: string) {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

describe("translations", () => {
  it("have the same keys in French and English", () => {
    expect(keys(en).sort()).toEqual(keys(fr).sort());
  });

  it("use the same {placeholders} in both languages", () => {
    const lookup = (dict: unknown, path: string) => path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], dict);
    for (const path of keys(fr)) {
      const a = lookup(fr, path);
      const b = lookup(en, path);
      if (typeof a === "string" && typeof b === "string") expect(placeholders(b), path).toEqual(placeholders(a));
    }
  });

  it("have the same keys in French and Malagasy", () => {
    expect(keys(mg).sort()).toEqual(keys(fr).sort());
  });

  it("use the same {placeholders} in Malagasy as in French, and keep the names", () => {
    expect(problems(fr, mg)).toEqual([]);
    expect(protectedTerms).toContain("MVola");
  });

  it("the checker catches a lost placeholder, a lost name and a missing key", () => {
    const source = { a: "{count} scans avec MVola", b: "x" };
    expect(problems(source, { a: "scan {count} MVola", b: "y" })).toEqual([]);
    expect(problems(source, { a: "scan {total} MVola", b: "y" }).length).toBe(1);
    expect(problems(source, { a: "scan {count} Telma", b: "y" }).length).toBe(1);
    expect(problems(source, { a: "scan {count} MVola" })).toEqual([["b", "missing"]]);
  });

  it("legal documents have the same sections in both languages", () => {
    for (const kind of ["privacy", "terms"] as const) {
      expect(legalDocuments[kind].en.sections.length).toBe(legalDocuments[kind].fr.sections.length);
    }
  });
});
