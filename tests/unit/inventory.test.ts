import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { mockAnalysis, mockReceipt } from "@/lib/ai/mock";
import type { Analysis } from "@/lib/ai/schema";
import { discoverCards } from "@/lib/discoverFeatures";
import {
  canAddToHome,
  fillFromPaper,
  guessCategory,
  guessRoom,
  inventoryTotals,
  isHomePaper,
  itemFieldsFrom,
  itemsByRoom,
  MAX_PAPERS,
  plannedWarrantyReminders,
  purchaseFieldsFrom,
  warrantyReminderAt,
  warrantyStatus,
  withPaper,
  type HomeItem,
} from "@/lib/inventory";
import { inventoryFileName, inventoryRows, inventorySummary, pdfItemLines } from "@/lib/inventoryExport";
import { defaultFeatureSettings, hasFeature, planFor, withFeatureDefaults, type FeatureSettings } from "@/lib/plans";
import { reconcileHomeReminderState, HOME_ITEM_NOTIFICATION_PREFIX, type HomeReminderDeps, type ScheduledHomeReminders } from "@/services/homeItemReminders";
import { homeItemStore } from "@/services/homeItemStore";
import { tapTarget } from "@/services/notificationTap";
import type { HistoryEntry } from "@/types/history";

const t = (key: string, params?: Record<string, string | number>) => (params ? `${key} ${JSON.stringify(params)}` : key);
const day = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime();

const item = (fields: Partial<HomeItem> = {}): HomeItem => ({ id: "i1", name: "Frigo", scanIds: [], createdAt: 1, updatedAt: 1, ...fields });

const objectScan = (title: string, tags: string[] = [], facts: Analysis["facts"] = []): Analysis => ({ ...mockAnalysis("object", "fr"), category: "object", title, tags, facts });

describe("the warranty", () => {
  it("is on until the end of its last day, then over; none without a date", () => {
    const thing = item({ warrantyUntil: "2027-03-12" });
    expect(warrantyStatus(thing, day(2027, 3, 12, 23))).toBe("active");
    expect(warrantyStatus(thing, day(2027, 3, 13, 0))).toBe("ended");
    expect(warrantyStatus(item(), day(2027, 1, 1))).toBeNull();
    expect(warrantyStatus(item({ warrantyUntil: "12/03/2027" }), day(2027, 1, 1))).toBeNull();
  });

  it("is reminded 30 days before its end, at 9:00, only when still to come and allowed", () => {
    const thing = item({ warrantyUntil: "2027-03-12" });
    expect(warrantyReminderAt(thing)).toBe(day(2027, 2, 10, 9));
    expect(plannedWarrantyReminders([thing], day(2027, 1, 1)).get("i1")?.at).toBe(day(2027, 2, 10, 9));
    expect(plannedWarrantyReminders([thing], day(2027, 2, 11)).size).toBe(0);
    expect(plannedWarrantyReminders([thing], day(2027, 1, 1), false).size).toBe(0);
    expect(plannedWarrantyReminders([item()], day(2027, 1, 1)).size).toBe(0);
  });
});

describe("the warranty notifications", () => {
  const texts = (thing: HomeItem, endsAt: number) => ({ title: thing.name, body: `${thing.name} ${endsAt}` });
  function deps(start: ScheduledHomeReminders = {}) {
    let saved = start;
    let next = 100;
    const log: string[] = [];
    const value: HomeReminderDeps = {
      permission: async () => "granted",
      notify: async ({ entryId }) => {
        log.push(`notify ${entryId}`);
        return next++;
      },
      cancel: async (id) => void log.push(`cancel ${id}`),
      pending: async () => null,
      load: () => saved,
      save: (scheduled) => void (saved = scheduled),
    };
    return { value, log, saved: () => saved };
  }

  it("schedules one per thing, keeps it, and cancels it when the plan stops (canRemind)", async () => {
    const thing = item({ warrantyUntil: "2027-03-12" });
    const device = deps();
    await reconcileHomeReminderState([thing], texts, device.value, { now: day(2027, 1, 1) });
    expect(device.log).toEqual([`notify ${HOME_ITEM_NOTIFICATION_PREFIX}i1`]);
    await reconcileHomeReminderState([thing], texts, device.value, { now: day(2027, 1, 2) });
    expect(device.log).toHaveLength(1);
    await reconcileHomeReminderState([thing], texts, device.value, { now: day(2027, 1, 2), enabled: false });
    expect(device.log.at(-1)).toBe("cancel 100");
    expect(device.saved()).toEqual({});
  });

  it("moves it when the date changes, and asks nothing without the permission", async () => {
    const device = deps();
    await reconcileHomeReminderState([item({ warrantyUntil: "2027-03-12" })], texts, device.value, { now: day(2027, 1, 1) });
    await reconcileHomeReminderState([item({ warrantyUntil: "2027-06-12" })], texts, device.value, { now: day(2027, 1, 1) });
    expect(device.log).toEqual([`notify ${HOME_ITEM_NOTIFICATION_PREFIX}i1`, "cancel 100", `notify ${HOME_ITEM_NOTIFICATION_PREFIX}i1`]);
    const denied = deps();
    denied.value.permission = async () => "denied";
    await reconcileHomeReminderState([item({ warrantyUntil: "2027-03-12" })], texts, denied.value, { now: day(2027, 1, 1) });
    expect(denied.log).toEqual([]);
  });

  it("opens the thing in Ma maison when tapped", () => {
    expect(tapTarget(`${HOME_ITEM_NOTIFICATION_PREFIX}i1`)).toEqual({ pathname: "/inventory", query: { open: "i1" } });
  });
});

describe("totals and rooms", () => {
  const things = [item({ id: "a", name: "Télé", room: "living", priceMga: 900000 }), item({ id: "b", name: "Frigo", room: "kitchen", priceMga: 1500000 }), item({ id: "c", name: "Canapé", room: "living" }), item({ id: "d", name: "Radio" })];

  it("adds up the known prices and counts the others", () => {
    expect(inventoryTotals(things)).toEqual({ count: 4, totalMga: 2400000, unpriced: 2 });
  });

  it("groups by room in the app's order, by name, with each room's value", () => {
    expect(itemsByRoom(things).map((group) => [group.room, group.items.map((thing) => thing.name), group.totalMga])).toEqual([
      ["living", ["Canapé", "Télé"], 900000],
      ["kitchen", ["Frigo"], 1500000],
      ["other", ["Radio"], 0],
    ]);
  });
});

describe("papers", () => {
  it("links a scan once, up to the limit", () => {
    expect(withPaper([], "s1")).toEqual(["s1"]);
    expect(withPaper(["s1"], "s1")).toBeNull();
    expect(withPaper(Array.from({ length: MAX_PAPERS }, (_, index) => `s${index}`), "new")).toBeNull();
    expect(withPaper(undefined, "")).toBeNull();
  });

  it("knows an invoice, a receipt or a warranty card from other scans", () => {
    expect(isHomePaper(mockReceipt("fr"))).toBe(true);
    const document = mockReceipt("fr").document!;
    expect(isHomePaper({ category: "document", document: { ...document, receipt: null, paper: "warranty", type: "Carte" } })).toBe(true);
    expect(isHomePaper({ category: "document", document: { ...document, receipt: null, paper: null, type: "Facture" } })).toBe(true);
    expect(isHomePaper({ category: "document", document: { ...document, receipt: null, paper: null, type: "Lettre" } })).toBe(false);
    expect(isHomePaper(objectScan("Frigo"))).toBe(false);
  });

  it("reads the purchase from a receipt in ariary, and fills only what is missing", () => {
    const receipt = mockReceipt("fr");
    const document = { ...receipt.document!, receipt: { ...receipt.document!.receipt!, total: 1850000.4, currency: "MGA", date: "2026-03-12", merchant: " Jumbo Score " } };
    expect(purchaseFieldsFrom({ document })).toEqual({ boughtOn: "2026-03-12", priceMga: 1850000, store: "Jumbo Score" });
    expect(purchaseFieldsFrom({ document: { ...document, receipt: { ...document.receipt, currency: "EUR" } } }).priceMga).toBeUndefined();
    const filled = fillFromPaper(item({ store: "Chez Rado" }), { document });
    expect([filled.store, filled.priceMga, filled.boughtOn]).toEqual(["Chez Rado", 1850000, "2026-03-12"]);
    const warranty = { ...document, receipt: null, bill: null, paper: "warranty" as const, expiresOn: "2028-03-12" };
    expect(purchaseFieldsFrom({ document: warranty }).warrantyUntil).toBe("2028-03-12");
  });
});

describe("from an object scan", () => {
  it("guesses the category and the room", () => {
    expect(guessCategory(objectScan("Réfrigérateur Samsung"))).toBe("appliance");
    expect(guessRoom(objectScan("Réfrigérateur Samsung"), "appliance")).toBe("kitchen");
    expect(guessRoom(objectScan("Machine à laver LG"), "appliance")).toBe("bathroom");
    expect(guessCategory(objectScan("Smart TV 55 pouces", ["télévision"]))).toBe("electronics");
    expect(guessCategory(objectScan("Canapé d'angle"))).toBe("furniture");
    expect(guessCategory(objectScan("Vase en céramique"))).toBeUndefined();
    expect(guessRoom(objectScan("Vase"), undefined)).toBeUndefined();
  });

  it("fills the name, and the serial number only when one was read", () => {
    expect(itemFieldsFrom(objectScan("Smart TV Samsung", ["tv"], [{ label: "Numéro de série", value: "0A1B2C3D" }]))).toEqual({ name: "Smart TV Samsung", category: "electronics", room: "living", serial: "0A1B2C3D" });
    expect(itemFieldsFrom(objectScan("Vase", [], [{ label: "Série", value: "Collection printemps" }]))).toEqual({ name: "Vase" });
    expect(canAddToHome(objectScan("Vase"))).toBe(true);
    expect(canAddToHome({ category: "plant" })).toBe(false);
  });
});

describe("the store", () => {
  beforeEach(() => homeItemStore.wipe());

  const entry = (id: string, analysis: Analysis): HistoryEntry =>
    ({ id, createdAt: 1, mode: "object", thumbnail: "", preview: "", analysis, meta: { model: "demo", demo: true, durationMs: 1 } }) as HistoryEntry;

  it("adds a thing from a scan, then links a receipt that fills its purchase", async () => {
    const created = await homeItemStore.addFromScan(entry("scan-1", objectScan("Réfrigérateur Samsung")), "Mon objet");
    expect(created).toMatchObject({ name: "Réfrigérateur Samsung", category: "appliance", room: "kitchen", fromScanId: "scan-1", scanIds: [] });
    const receipt = mockReceipt("fr");
    const paper = entry("scan-2", { ...receipt, document: { ...receipt.document!, receipt: { ...receipt.document!.receipt!, total: 1200000, currency: "MGA", date: "2026-02-01" } } });
    expect(await homeItemStore.linkPaper(created.id, paper)).toBe(true);
    expect(await homeItemStore.linkPaper(created.id, paper)).toBe(false);
    const saved = await homeItemStore.get(created.id);
    expect(saved).toMatchObject({ scanIds: ["scan-2"], priceMga: 1200000, boughtOn: "2026-02-01" });
    await homeItemStore.unlinkPaper(created.id, "scan-2");
    expect((await homeItemStore.get(created.id))?.scanIds).toEqual([]);
  });

  it("cleans what the form sends", async () => {
    const created = await homeItemStore.create({ name: "  ", priceMga: -5, boughtOn: "hier", room: "garden" as "other", note: " Sous l'escalier " }, "Mon objet");
    expect(created).toMatchObject({ name: "Mon objet", priceMga: undefined, boughtOn: undefined, room: undefined, note: "Sous l'escalier" });
    await homeItemStore.remove(created.id);
    expect(await homeItemStore.list()).toEqual([]);
  });
});

describe("the export", () => {
  const things = [item({ id: "a", name: "Frigo", room: "kitchen", category: "appliance", priceMga: 1500000, boughtOn: "2026-03-12", store: "Jumbo", warrantyUntil: "2028-03-12", serial: "RT38", scanIds: ["s1"] }), item({ id: "b", name: "Radio" })];

  it("lists the things room by room, with the warranty as of now", () => {
    const rows = inventoryRows(things, t, day(2027, 1, 1));
    expect(rows.map((row) => [row.item.name, row.room, row.warranty, row.priceMga, row.papers])).toEqual([
      ["Frigo", "inventory.rooms.kitchen", "inventory.warranty.active", 1500000, 1],
      ["Radio", "inventory.rooms.other", "", null, 0],
    ]);
    const lines = pdfItemLines(rows[0], t, "fr");
    expect(lines[0]).toMatch(/^Frigo · 1\s500\s000 Ar$/);
    expect(lines).toContain('inventory.export.serial {"serial":"RT38"}');
    expect(pdfItemLines(rows[1], t, "fr")).toEqual(["Radio"]);
  });

  it("sums up the value, and names the file by day", () => {
    expect(inventorySummary(things, t, "fr").map((line) => line.label)).toEqual(["inventory.export.count", "inventory.export.total", "inventory.export.unpriced"]);
    expect(inventoryFileName("2026-10-30", "pdf")).toBe("ma-maison-2026-10-30.pdf");
  });
});

describe("the plan", () => {
  it("is Premium and up, in the Admin and on the discover page", () => {
    expect(planFor("inventory")).toBe("premium");
    expect(hasFeature("lite", "inventory")).toBe(false);
    expect(hasFeature("premium", "inventory")).toBe(true);
    expect(discoverCards(null).map((card) => card.feature)).toContain("inventory");
  });

  it("reaches a record saved before it existed, with its default plans", () => {
    const stored = JSON.parse(JSON.stringify(defaultFeatureSettings)) as FeatureSettings;
    for (const plan of Object.keys(stored.features) as Array<keyof FeatureSettings["features"]>) stored.features[plan] = stored.features[plan].filter((feature) => feature !== "inventory");
    delete (stored.featureStatus as Partial<FeatureSettings["featureStatus"]>).inventory;
    const merged = withFeatureDefaults(stored);
    expect(merged.features.premium).toContain("inventory");
    expect(merged.features.pro).toContain("inventory");
    expect(merged.features.lite).not.toContain("inventory");
  });
});
