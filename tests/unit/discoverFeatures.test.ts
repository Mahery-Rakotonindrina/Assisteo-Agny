import { describe, expect, it } from "vitest";
import { discoverCards, discoverFeatures } from "@/lib/discoverFeatures";
import { defaultFeatureSettings, featureFromConfig, type FeatureSettings, type PlanFeature } from "@/lib/plans";

const shown = (cards: ReturnType<typeof discoverCards>) => cards.map((card) => card.feature);
const labelOf = (cards: ReturnType<typeof discoverCards>, feature: PlanFeature) => cards.find((card) => card.feature === feature)?.from;

/** The default settings, with a feature's mode changed. */
function withMode(feature: PlanFeature, mode: "on" | "test" | "off"): FeatureSettings {
  return { ...defaultFeatureSettings, featureStatus: { ...defaultFeatureSettings.featureStatus, [feature]: { mode, testers: ["a@b.mg"] } } };
}

/** The default settings, with a feature ticked from `plan` up. */
function openFrom(feature: PlanFeature, from: "lite" | "premium"): FeatureSettings {
  const ladder = ["lite", "premium", "pro", "unlimited"] as const;
  const features = { ...defaultFeatureSettings.features };
  for (const plan of ladder.slice(ladder.indexOf(from))) features[plan] = [...new Set([...features[plan], feature])];
  return { ...defaultFeatureSettings, features };
}

describe("discoverCards", () => {
  it("before the settings: the built-in ladder, unlabelled, without the Admin-only features", () => {
    const cards = discoverCards(null);
    expect(cards.every((card) => card.from === null)).toBe(true);
    expect(shown(cards)).toContain("garage");
    expect(shown(cards)).not.toContain("expenses");
    expect(shown(cards)).not.toContain("loans");
  });

  it("with the default settings: the same cards, each with its lowest plan", () => {
    const cards = discoverCards(featureFromConfig(defaultFeatureSettings));
    expect(shown(cards)).toEqual(shown(discoverCards(null)));
    expect(labelOf(cards, "garage")).toBe("premium");
    expect(labelOf(cards, "reminders")).toBe("lite");
    expect(labelOf(cards, "reseller")).toBe("pro");
  });

  it("hides a feature switched off or in test", () => {
    expect(shown(discoverCards(featureFromConfig(withMode("garage", "off"))))).not.toContain("garage");
    expect(shown(discoverCards(featureFromConfig(withMode("pdfExport", "test"))))).not.toContain("pdfExport");
  });

  it("shows an Admin-only feature once a sold plan has it", () => {
    const cards = discoverCards(featureFromConfig(openFrom("loans", "premium")));
    expect(labelOf(cards, "loans")).toBe("premium");
    expect(shown(cards)).not.toContain("expenses");
  });

  it("keeps the page order, and the built-in plan for a feature an older server leaves out", () => {
    const cards = discoverCards({ garage: "lite" });
    expect(labelOf(cards, "garage")).toBe("lite");
    expect(labelOf(cards, "multiPage")).toBe("premium");
    const order = shown(cards).map((feature) => discoverFeatures.indexOf(feature));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
