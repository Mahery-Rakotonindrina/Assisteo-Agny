import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { acceptSharedList, acceptSharedParcel, isOwnShare, listIdOfShare, listShareId, parcelShareUpdates, parcelSnapshot } from "@/lib/householdShares";
import { listStore, sharedListStore } from "@/services/listStore";
import { detachSharedLists, shareList, unshareList } from "@/services/sharedLists";
import { refreshSharedParcels, shareParcel, sharedParcelStore } from "@/services/sharedParcels";
import type { Parcel } from "@/services/parcelStore";

const parcel = (patch: Partial<Parcel> = {}): Parcel =>
  ({
    id: "p1",
    title: "Robe rouge",
    client: "Tante Voahangy",
    clientPhone: "034 11 111 11",
    info: { status: "in_transit", statusLabel: "En transit", trackingNumber: "YT1", items: [] },
    scanIds: ["scan-1"],
    timeline: [{ at: 1, status: "in_transit", statusLabel: "En transit", event: null, scanId: "scan-1" }],
    createdAt: 1,
    updatedAt: 10,
    priceMga: 80_000,
    fees: [{ id: "f", label: "Fret", amountMga: 9_000 }],
    salePriceMga: 130_000,
    paidMga: 100_000,
    ...patch,
  }) as Parcel;

describe("what the household sees of a parcel", () => {
  it("where it is, never what it cost, the reseller's client nor the author's scans", () => {
    const snapshot = parcelSnapshot(parcel(), "home", "anna");
    expect(snapshot).toMatchObject({ id: "parcel:p1", sourceId: "p1", title: "Robe rouge", householdId: "home", userId: "anna", sourceUpdatedAt: 10 });
    const text = JSON.stringify(snapshot);
    expect(text).not.toMatch(/80000|9000|130000|100000|Fret|034|scan-1|priceMga|fees|salePriceMga|paidMga|Voahangy|client/);
    expect(acceptSharedParcel({ ...snapshot, updatedAt: 11 })).not.toBeNull();
  });

  it("follows its parcel: written again after a change, stopped once the parcel is gone; the others' left alone", () => {
    const own = { ...parcelSnapshot(parcel(), "home", "anna"), updatedAt: 11 };
    const gone = { ...parcelSnapshot(parcel({ id: "p2" }), "home", "anna"), updatedAt: 11 };
    const others = { ...parcelSnapshot(parcel({ id: "p3" }), "home", "ben"), updatedAt: 11 };
    const { rewrite, stop } = parcelShareUpdates([own, gone, others], [parcel({ updatedAt: 20 })], "anna");
    expect(rewrite.map((item) => item.id)).toEqual(["p1"]);
    expect(stop).toEqual(["parcel:p2"]);
    expect(parcelShareUpdates([own], [parcel({ updatedAt: 10 })], "anna")).toEqual({ rewrite: [], stop: [] });
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
  it("keeps the copy in step with the parcel, and stops it when the parcel is removed", async () => {
    await sharedParcelStore.wipe();
    await shareParcel(parcel(), "home", "anna");
    await refreshSharedParcels([parcel({ updatedAt: 30, info: { ...parcel().info, status: "delivered" } })], "anna");
    const [copy] = await sharedParcelStore.list();
    expect(copy.info.status).toBe("delivered");
    expect(copy.sourceUpdatedAt).toBe(30);
    await refreshSharedParcels([], "anna");
    expect(await sharedParcelStore.list()).toEqual([]);
  });
});
