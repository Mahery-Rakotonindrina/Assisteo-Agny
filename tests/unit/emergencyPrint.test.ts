import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { blankCard, type EmergencyCard } from "@/lib/emergencyCard";
import { characters, clampLines, pictureFileName, printableCard, stackRows, wrapText } from "@/lib/emergencyPrint";

const translate = (texts: object) => (key: string, params: Record<string, string | number> = {}) => {
  const text = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], texts);
  if (typeof text !== "string") throw new Error(`missing ${key}`);
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
};
const t = translate(fr);
const date = (at: number) => `jour ${at}`;
// One unit per character: easy widths to reason about.
const measure = (text: string) => [...text].length;

const card = (patch: Partial<EmergencyCard> = {}): EmergencyCard => ({
  ...blankCard(100),
  bloodGroup: "O-",
  allergies: "pénicilline, arachide ;",
  conditions: "Asthme",
  contactName: "Voahangy",
  contactRelation: "ma sœur",
  contactPhone: "034 12 345 67",
  ...patch,
});

describe("Fiche d'urgence à imprimer", () => {
  it("shows what is filled in, and nothing for an empty card", () => {
    expect(printableCard(null, t, date)).toBeNull();
    expect(printableCard(blankCard(5), t, date)).toBeNull();
    const printed = printableCard(card({ note: "Porte un pacemaker" }), t, date, "Hery")!;
    expect(printed.title).toBe("Fiche d’urgence de Hery");
    expect(printed.blood).toBe("O−");
    expect(printed.rows).toEqual([
      { label: "Allergies", value: "pénicilline, arachide" },
      { label: "Maladies ou traitements de fond", value: "Asthme" },
    ]);
    expect(printed.contact).toEqual({ label: "Personne à prévenir", who: "Voahangy (ma sœur)", phone: "034 12 345 67" });
    expect(printed.note).toEqual({ label: "Note", value: "Porte un pacemaker" });
    expect(printed.updated).toBe("Mise à jour le jour 100");
  });

  it("leaves out every empty field", () => {
    const printed = printableCard(card({ bloodGroup: null, allergies: "", conditions: "", contactName: "", contactPhone: "", note: "Diabétique", updatedAt: 0 }), t, date)!;
    expect(printed.title).toBe("Fiche d’urgence");
    expect(printed.blood).toBeNull();
    expect(printed.rows).toEqual([]);
    expect(printed.contact).toBeNull();
    expect(printed.updated).toBeNull();
    // A phone without a name, and the reverse.
    expect(printableCard(card({ contactName: "", contactRelation: "" }), t, date)!.contact?.who).toBe("");
    expect(printableCard(card({ contactPhone: "" }), t, date)!.contact?.phone).toBe("");
    expect(printableCard(card({ bloodGroup: "unknown" }), t, date)!.blood).toBe("Je ne sais pas");
  });

  it("reads in English too", () => {
    const printed = printableCard(card(), translate(en), date, "Hery")!;
    expect(printed.title).toBe("Hery’s emergency card");
    expect(printed.contact?.label).toBe("Person to call");
  });

  it("wraps on words, keeps new lines, and cuts only a word too long", () => {
    expect(wrapText("pénicilline, arachide, lait", 12, measure)).toEqual(["pénicilline,", "arachide,", "lait"]);
    expect(wrapText("un\n\ndeux  trois", 20, measure)).toEqual(["un", "deux trois"]);
    expect(wrapText("0341234567890", 5, measure)).toEqual(["03412", "34567", "890"]);
    expect(wrapText("", 10, measure)).toEqual([]);
  });

  it("ends a cut text with an ellipsis that fits", () => {
    expect(clampLines(["a", "b"], 2, 5, measure)).toEqual(["a", "b"]);
    expect(clampLines(["un", "deux", "trois"], 2, 5, measure)).toEqual(["un", "deux…"]);
    expect(clampLines(["un", "abcde", "x"], 2, 5, measure)).toEqual(["un", "abcd…"]);
    expect(clampLines(["un"], 0, 5, measure)).toEqual([]);
  });

  it("never cuts an emoji or an accent in two", () => {
    // Width by whole characters: an emoji counts as one, whatever its code units.
    const shown = (text: string) => characters(text).length;
    expect(characters("a👨‍👩‍👧é")).toEqual(["a", "👨‍👩‍👧", "é"]);
    expect(clampLines(["un", "ab👍🏽cd", "x"], 2, 4, shown)).toEqual(["un", "ab👍🏽…"]);
    expect(wrapText("👍🏽👍🏽👍🏽", 2, shown)).toEqual(["👍🏽👍🏽", "👍🏽"]);
  });

  it("stacks rows in the room there is, cutting the last one shown", () => {
    const rows = [
      { label: "Allergies", value: "aaaa bbbb cccc" },
      { label: "Note", value: "dddd" },
    ];
    const room = { width: 4, labelHeight: 1, lineHeight: 1, gap: 1 };
    // Everything fits: 1 + 3 + 1 + 1 + 1.
    expect(stackRows(rows, { ...room, height: 7 }, measure)).toEqual([
      { label: "Allergies", lines: ["aaaa", "bbbb", "cccc"] },
      { label: "Note", lines: ["dddd"] },
    ]);
    // Too little for the second row: dropped, the first one whole.
    expect(stackRows(rows, { ...room, height: 5 }, measure)).toEqual([{ label: "Allergies", lines: ["aaaa", "bbbb", "cccc"] }]);
    // The first row itself cut.
    expect(stackRows(rows, { ...room, height: 3 }, measure)).toEqual([{ label: "Allergies", lines: ["aaaa", "bbb…"] }]);
    // Not even a label and a line.
    expect(stackRows(rows, { ...room, height: 1 }, measure)).toEqual([]);
  });

  it("names the picture like the PDF", () => {
    expect(pictureFileName("Fiche-d-urgence-de-Hery.pdf")).toBe("Fiche-d-urgence-de-Hery.png");
  });
});
