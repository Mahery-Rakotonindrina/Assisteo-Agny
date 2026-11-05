import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { acceptSharedList, acceptSharedParcel, isOwnShare, listIdOfShare, listShareId, parcelShareUpdates, parcelSnapshot } from "@/lib/householdShares";
import { listStore, sharedListStore } from "@/services/listStore";
import { detachSharedLists, shareList, unshareList } from "@/services/sharedLists";
import { refreshSharedParcels, shareParcel, sharedParcelStore, stopSharesOf } from "@/services/sharedParcels";
import { parcelStore, type Parcel } from "@/services/parcelStore";

/** A parcel with every field filled: what was paid, the shop's references, the reseller's tools (freight, lot, client's number). */
const parcel = (patch: Partial<Parcel> = {}): Parcel =>
  ({
    id: "p1",
    title: "Robe rouge",
    client: "Tante Voahangy",
    clientPhone: "034 11 111 11",
    shippingMode: "sea",
    info: {
      platform: "Pinduoduo",
      orderNumber: "ORDER-250918",
      trackingNumber: "YT1",
      carrier: "YunExpress",
      status: "in_transit",
      statusLabel: "En transit",
      lastEvent: { description: "Parti de Guangzhou", location: "Guangzhou", at: "2026-10-20 10:00" },
      items: [{ name: "Robe", variant: "Rouge, M", quantity: 2, price: "¥77.70" }],
      total: "¥221.45",
      seller: "Boutique Liang",
      orderedAt: "2026-10-01",
      shippedAt: "2026-10-03",
      estimatedDelivery: "2026-11-30",
      destinationCity: "Antananarivo",
      shippingMode: "sea",
    },
    scanIds: ["scan-1"],
    timeline: [{ at: 1, status: "in_transit", statusLabel: "En transit", event: null, scanId: "scan-1" }],
    createdAt: 1,
    updatedAt: 10,
    priceMga: 80_000,
    fees: [
      { id: "f", label: "Douane", amountMga: 9_000 },
      { id: "freight-kg", label: "Fret 2,5 kg × 12 000 Ar", amountMga: 30_000 },
    ],
    freight: { forwarder: "Trans Mada", weightKg: 2.5, rateMga: 12_000, mode: "sea" },
    lot: { id: "lot-1", name: "Conteneur de novembre", mode: "sea", departedAt: "2026-11-02" },
    salePriceMga: 130_000,
    paidMga: 100_000,
    soldAt: 5,
    forResale: true,
    ...patch,
  }) as Parcel;

describe("what the household sees of a parcel", () => {
  it("where it is, never what it cost, the reseller's client nor the author's scans", () => {
    const snapshot = parcelSnapshot(parcel(), "home", "anna");
    expect(snapshot).toMatchObject({ id: "parcel:p1", sourceId: "p1", title: "Robe rouge", householdId: "home", userId: "anna", sourceUpdatedAt: 10 });
    const text = JSON.stringify(snapshot);
    // No money, no shop reference, nothing of the reseller's tools nor of their client.
    for (const leak of [/80000|9000|30000|12000|130000|100000/, /¥|77\.70|221/, /ORDER-250918|Liang|orderNumber|seller|total|price/i, /Fret|Douane|Trans Mada|Conteneur|freight|lot|forwarder|weight/i, /034|Voahangy|client/i, /scan-1|soldAt|forResale|paidMga/]) {
      expect(text).not.toMatch(leak);
    }
    // What it is and where: kept.
    expect(snapshot.info).toEqual({
      status: "in_transit",
      statusLabel: "En transit",
      trackingNumber: "YT1",
      carrier: "YunExpress",
      platform: "Pinduoduo",
      lastEvent: { description: "Parti de Guangzhou", location: "Guangzhou", at: "2026-10-20 10:00" },
      shippedAt: "2026-10-03",
      estimatedDelivery: "2026-11-30",
      destinationCity: "Antananarivo",
      shippingMode: "sea",
      items: [{ name: "Robe", variant: "Rouge, M", quantity: 2 }],
    });
    expect(acceptSharedParcel({ ...snapshot, updatedAt: 11 })).not.toBeNull();
    // A copy written by an older or altered app: what is not on the list is dropped on reading.
    const altered = acceptSharedParcel({ ...snapshot, updatedAt: 11, priceMga: 1, info: { ...snapshot.info, total: "¥9", items: [{ name: "Robe", variant: null, quantity: 1, price: "¥9" }] } });
    expect(JSON.stringify(altered)).not.toMatch(/¥|priceMga|total|price/);
  });

  it("follows its parcel: written again after a change; a parcel not on this device yet stops nothing; the others' left alone", () => {
    const own = { ...parcelSnapshot(parcel(), "home", "anna"), updatedAt: 11 };
    const notHereYet = { ...parcelSnapshot(parcel({ id: "p2" }), "home", "anna"), updatedAt: 11 };
    const others = { ...parcelSnapshot(parcel({ id: "p3", updatedAt: 99 }), "home", "ben"), updatedAt: 11 };
    expect(parcelShareUpdates([own, notHereYet, others], [parcel({ updatedAt: 20 }), parcel({ id: "p3", updatedAt: 200 })], "anna").map((item) => item.id)).toEqual(["p1"]);
    expect(parcelShareUpdates([own], [parcel({ updatedAt: 10 })], "anna")).toEqual([]);
  });
});

describe("a list read from another member", () => {
  it("is kept only when well formed", () => {
    const list = { id: "list:l1", title: "Courses", kind: "shopping", items: [{ id: "i", text: "Riz", done: false }], createdAt: 1, updatedAt: 2 };
    expect(acceptSharedList(list)).not.toBeNull();
    expect(acceptSharedList({ ...list, id: "l1" })).toBeNull();
    expect(acceptSharedList({ ...list, items: "x" })).toBeNull();
    expect(listIdOfShare(listShareId("l1"))).toBe("l1");
    expect(listShareId("list:l1")).toBe("list:l1");
    expect(isOwnShare({ userId: "ben" }, "anna")).toBe(false);
    expect(isOwnShare({}, "anna")).toBe(true);
  });
});

describe("sharing a list", () => {
  it("moves it to the household, ticked by anyone there, and back to its author when stopped", async () => {
    await listStore.wipe();
    await sharedListStore.wipe();
    const list = await listStore.create("Courses de la semaine");
    await listStore.addItem(list.id, "Riz");
    await shareList((await listStore.list())[0], "home", "anna");
    expect(await listStore.list()).toEqual([]);
    const [shared] = await sharedListStore.list();
    expect(shared).toMatchObject({ id: `list:${list.id}`, householdId: "home", userId: "anna", title: "Courses de la semaine" });
    // Another member ticks the rice.
    await sharedListStore.toggle(shared.id, shared.items[0].id);
    // Only the author stops it.
    expect(await unshareList((await sharedListStore.list())[0], "ben")).toBe(false);
    expect(await unshareList((await sharedListStore.list())[0], "anna")).toBe(true);
    expect(await sharedListStore.list()).toEqual([]);
    const [back] = await listStore.list();
    expect(back).toMatchObject({ id: list.id, title: "Courses de la semaine" });
    expect(back.items[0].done).toBe(true);
    expect(back.householdId).toBeUndefined();
  });

  it("out of the household: one's own lists come back, the others' go", async () => {
    await listStore.wipe();
    await sharedListStore.wipe();
    const mine = await listStore.create("À moi");
    await shareList(mine, "home", "anna");
    await sharedListStore.adopt({ id: "list:x", title: "De Ben", kind: "todo", items: [], createdAt: 1, updatedAt: 1, householdId: "home", userId: "ben" });
    await detachSharedLists("anna");
    expect((await listStore.list()).map((list) => list.title)).toEqual(["À moi"]);
    expect(await sharedListStore.list()).toEqual([]);
  });
});

describe("sharing a parcel", () => {
  it("keeps the copy in step with the parcel; a device without the parcel yet keeps it; removing the parcel stops it", async () => {
    await sharedParcelStore.wipe();
    await shareParcel(parcel(), "home", "anna");
    await refreshSharedParcels([parcel({ updatedAt: 30, info: { ...parcel().info, status: "delivered" } })], "anna");
    const [copy] = await sharedParcelStore.list();
    expect(copy.info.status).toBe("delivered");
    expect(copy.sourceUpdatedAt).toBe(30);
    // Just signed in: the parcels are not synced yet.
    await refreshSharedParcels([], "anna");
    expect(await sharedParcelStore.list()).toHaveLength(1);
    // Another member's copy is never stopped by me.
    await stopSharesOf(["p1"], "ben");
    expect(await sharedParcelStore.list()).toHaveLength(1);
    await stopSharesOf(["p1"], "anna");
    expect(await sharedParcelStore.list()).toEqual([]);
  });

  it("tells who listens which parcels the user removed", async () => {
    await parcelStore.wipe();
    const seen: string[][] = [];
    const stop = parcelStore.onRemoved((ids) => seen.push(ids));
    const scan = (id: string, orderNumber: string) => ({
      id,
      createdAt: 1,
      mode: "auto" as const,
      thumbnail: "",
      preview: "",
      analysis: { parcel: { ...parcel().info, orderNumber, trackingNumber: null } , title: "Colis" } as never,
      meta: { model: "demo", demo: true, durationMs: 1 },
    });
    const a = await parcelStore.add(scan("s1", "A-1"));
    await parcelStore.add(scan("s2", "B-2"));
    await parcelStore.remove(a.id);
    await parcelStore.removeAll();
    stop();
    expect(seen.map((ids) => ids.length)).toEqual([1, 1]);
    expect(seen[0]).toEqual([a.id]);
  });
});
