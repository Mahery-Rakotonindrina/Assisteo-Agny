import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { pick } from "@/lib/account/pick";
import { allergyTags, blankCard, bloodLabel, cardText, isCardEmpty, newerCard, normalizeCard, telHref, type EmergencyCard } from "@/lib/emergencyCard";
import { resetScreens } from "@/lib/screenReset";
import { syncedSettingKeys } from "@/lib/settings/SettingsProvider";

const translate = (texts: object) => (key: string, params: Record<string, string | number> = {}) => {
  const text = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], texts);
  if (typeof text !== "string") throw new Error(`missing ${key}`);
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
};

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

describe("Fiche d'urgence", () => {
  it("keeps only what a card holds, whatever was stored", () => {
    expect(normalizeCard(null)).toBeNull();
    expect(normalizeCard("A+")).toBeNull();
    const read = normalizeCard({ bloodGroup: "Z+", allergies: 12, note: "  x  ", contactPhone: "1".repeat(50), extra: true, updatedAt: "now" })!;
    expect(read).toEqual({ ...blankCard(), note: "x", contactPhone: "1".repeat(30) });
    expect(normalizeCard({ bloodGroup: "AB-" })!.bloodGroup).toBe("AB-");
  });

  it("is empty until something is said, an unknown blood group included", () => {
    expect(isCardEmpty(null)).toBe(true);
    expect(isCardEmpty(blankCard(5))).toBe(true);
    expect(isCardEmpty({ ...blankCard(), bloodGroup: "unknown" })).toBe(false);
    expect(isCardEmpty({ ...blankCard(), contactPhone: "034" })).toBe(false);
  });

  it("keeps the newer card between two devices, and the one there when the other has none (an older app)", () => {
    const older = card({ updatedAt: 100 });
    const newer = card({ bloodGroup: "A+", updatedAt: 200 });
    expect(newerCard(older, newer)).toEqual(newer);
    expect(newerCard(newer, older)).toEqual(newer);
    expect(newerCard(older, undefined)).toEqual(older);
    expect(newerCard(undefined, newer)).toEqual(newer);
    expect(newerCard(null, null)).toBeNull();
    // An emptied card is dated: it wins over the filled one it replaces.
    expect(isCardEmpty(newerCard(older, blankCard(300)))).toBe(true);
  });

  it("follows the account with the other synced settings, and has its reset", () => {
    expect(syncedSettingKeys).toContain("emergencyCard");
    // An older app's settings lack the key: nothing replaces the card then.
    expect("emergencyCard" in pick({ locale: "fr" } as Record<string, unknown>, syncedSettingKeys as readonly string[])).toBe(false);
    expect(resetScreens).toContain("health");
  });

  it("splits the allergies into tags", () => {
    expect(allergyTags("pénicilline, arachide ;\nlatex,,")).toEqual(["pénicilline", "arachide", "latex"]);
    expect(allergyTags("")).toEqual([]);
  });

  it("calls a number written any way", () => {
    expect(telHref("034 12 345 67")).toBe("tel:0341234567");
    expect(telHref("+261 34 12 345 67")).toBe("tel:+261341234567");
    expect(telHref("ok")).toBeNull();
  });

  it("writes the real minus sign of a blood group", () => {
    expect(bloodLabel("O-")).toBe("O−");
    expect(bloodLabel("AB+")).toBe("AB+");
  });

  it("shares only what is filled in, in French and in English", () => {
    const text = cardText(card(), translate(fr), () => "3 nov. 2026");
    expect(text.split("\n")).toEqual([
      "Ma fiche d’urgence",
      "Groupe sanguin : O−",
      "Allergies : pénicilline, arachide",
      "Maladies ou traitements de fond : Asthme",
      "Personne à prévenir : Voahangy (ma sœur) 034 12 345 67",
      "",
      "Mise à jour le 3 nov. 2026",
    ]);
    const short = cardText({ ...blankCard(), bloodGroup: "unknown", note: "Porte des lentilles" }, translate(en), () => "");
    expect(short.split("\n")).toEqual(["My emergency card", "Blood group: I don't know", "Note: Porte des lentilles"]);
  });
});
