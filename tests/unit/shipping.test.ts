import { describe, expect, it } from "vitest";
import { AnalysisSchema, normalizeStoredAnalysis } from "@/lib/ai/schema";
import { mockAnalysis } from "@/lib/ai/mock";
import { detectShippingMode, shippingModeOf, type ParcelInfo } from "@/lib/parcels";

const scanned = mockAnalysis("auto", "fr");
const info = (patch: Partial<ParcelInfo>): ParcelInfo => ({
  platform: null,
  orderNumber: null,
  trackingNumber: null,
  carrier: null,
  status: "in_transit",
  statusLabel: "En transit",
  lastEvent: null,
  items: [],
  total: null,
  seller: null,
  orderedAt: null,
  shippedAt: null,
  estimatedDelivery: null,
  destinationCity: null,
  shippingMode: null,
  ...patch,
});

describe("sea or air", () => {
  it("reads the forwarders' words, in Latin letters or Chinese", () => {
    expect(detectShippingMode(["MG-SEA-2041"])).toBe("sea");
    expect(detectShippingMode(["Envoi maritime, conteneur 12"])).toBe("sea");
    expect(detectShippingMode(["广州 海运 仓库"])).toBe("sea");
    expect(detectShippingMode(["TANA NORMAL 15kg"])).toBe("air");
    expect(detectShippingMode(["空运"])).toBe("air");
    expect(detectShippingMode(["Fret aérien"])).toBe("air");
  });

  it("says nothing when the texts don't, or say both", () => {
    expect(detectShippingMode(["YunExpress", "STO Express", null])).toBeNull();
    expect(detectShippingMode(["SEA or AIR"])).toBeNull();
    // Words inside other words don't count.
    expect(detectShippingMode(["Airtel", "Livraison normale", "Seattle"])).toBeNull();
  });

  it("takes the user's choice, then the scan, then a guess from the tracking", () => {
    expect(shippingModeOf({ shippingMode: "air", info: info({ shippingMode: "sea" }) })).toEqual({ mode: "air", source: "manual" });
    expect(shippingModeOf({ info: info({ shippingMode: "sea", trackingNumber: "NORMAL-1" }) })).toEqual({ mode: "sea", source: "scan" });
    expect(shippingModeOf({ info: info({ trackingNumber: "MG-SEA-2041" }) })).toEqual({ mode: "sea", source: "guess" });
    // Item names never count: "Air Max" is a shoe.
    expect(shippingModeOf({ info: info({ items: [{ name: "Nike Air Max", variant: null, quantity: 1, price: null }] }) })).toEqual({ mode: null, source: null });
  });

  it("still reads parcels scanned before the shipping mode existed", () => {
    const old = { ...scanned, parcel: { ...info({}) } as Record<string, unknown> };
    delete old.parcel.shippingMode;
    expect(AnalysisSchema.safeParse(normalizeStoredAnalysis(old)).success).toBe(true);
  });
});
