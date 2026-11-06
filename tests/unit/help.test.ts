import { describe, expect, it } from "vitest";
import { helpGuides, helpTopics, normalizeSearch, searchHelp } from "@/lib/help";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";

describe("help search", () => {
  const items = [{ text: "Faut-il créer un compte ? Non." }, { text: "L’app marche-t-elle sans réseau ?" }, { text: "Comment payer une offre ?" }];

  it("ignores case and accents", () => {
    expect(normalizeSearch("Réseau ÉTÉ")).toBe("reseau ete");
    expect(searchHelp(items, "RESEAU")).toHaveLength(1);
    expect(searchHelp(items, "creer")).toHaveLength(1);
  });

  it("needs every word, in any order", () => {
    expect(searchHelp(items, "payer offre")).toHaveLength(1);
    expect(searchHelp(items, "offre compte")).toHaveLength(0);
  });

  it("gives everything back for an empty query", () => {
    expect(searchHelp(items, "   ")).toEqual(items);
  });
});

describe("help texts", () => {
  const read = (dictionary: unknown, path: string) => path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], dictionary);

  it("has every topic, question and guide step in both languages", () => {
    for (const dictionary of [fr, en]) {
      for (const { id, questions } of helpTopics) {
        expect(read(dictionary, `help.topics.${id}.title`)).toBeTruthy();
        for (const question of questions) {
          expect(read(dictionary, `help.topics.${id}.questions.${question}.q`)).toBeTruthy();
          expect(read(dictionary, `help.topics.${id}.questions.${question}.a`)).toBeTruthy();
        }
      }
      for (const guide of helpGuides) {
        expect(read(dictionary, `help.guides.${guide}.title`)).toBeTruthy();
        for (const step of [1, 2, 3]) {
          expect(read(dictionary, `help.guides.${guide}.steps.${step}.t`)).toBeTruthy();
          expect(read(dictionary, `help.guides.${guide}.steps.${step}.b`)).toBeTruthy();
        }
      }
    }
  });
});
