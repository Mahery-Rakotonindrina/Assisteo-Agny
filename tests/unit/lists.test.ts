import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { mockAnalysis } from "@/lib/ai/mock";
import { compareLists, listProgress, listStore, type SavedList } from "@/services/listStore";
import type { HistoryEntry } from "@/types/history";

// The demo shopping list: 7 items, "Sucre" already crossed out.
const listScan = (() => {
  for (let i = 0; i < 8; i++) {
    const analysis = mockAnalysis("auto", "fr");
    if (analysis.list) return analysis;
  }
  throw new Error("no demo list");
})();
const entry = (id: string): HistoryEntry => ({
  id,
  createdAt: 1000,
  mode: "auto",
  thumbnail: "data:image/jpeg;base64,AA",
  preview: "data:image/jpeg;base64,AA",
  analysis: listScan,
  meta: { model: "demo", demo: true, durationMs: 1 },
});

describe("my lists", () => {
  beforeEach(async () => {
    await listStore.wipe();
  });

  it("keeps a list read on a scan once, with its items and photo", async () => {
    const list = await listStore.addFromScan(entry("s1"));
    expect(list).toMatchObject({ title: "Courses de la semaine", kind: "shopping", scanId: "s1", thumbnail: "data:image/jpeg;base64,AA" });
    expect(list.items.map((item) => [item.text, item.quantity ?? null, item.done])).toContainEqual(["Sucre", "1 kg", true]);
    expect(listProgress(list)).toEqual({ done: 1, total: 7 });
    expect((await listStore.addFromScan(entry("s1"))).id).toBe(list.id);
    expect(await listStore.list()).toHaveLength(1);
  });

  it("ticks, adds, edits and clears items", async () => {
    const { id } = await listStore.create("Tâches", "todo");
    await listStore.addItem(id, "  Payer la JIRAMA ", "");
    await listStore.addItem(id, "Acheter du riz", "5 kg");
    await listStore.addItem(id, "   ");
    let [list] = await listStore.list();
    expect(list.items.map((item) => [item.text, item.quantity])).toEqual([
      ["Payer la JIRAMA", undefined],
      ["Acheter du riz", "5 kg"],
    ]);

    await listStore.toggle(id, list.items[0].id);
    await listStore.editItem(id, list.items[1].id, { text: "Acheter du riz blanc", quantity: "10 kg" });
    [list] = await listStore.list();
    expect(list.items.map((item) => [item.text, item.quantity, item.done])).toEqual([
      ["Payer la JIRAMA", undefined, true],
      ["Acheter du riz blanc", "10 kg", false],
    ]);

    await listStore.uncheckAll(id);
    expect(listProgress((await listStore.list())[0]).done).toBe(0);
    await listStore.toggle(id, list.items[0].id);
    await listStore.clearDone(id);
    expect((await listStore.list())[0].items.map((item) => item.text)).toEqual(["Acheter du riz blanc"]);

    await listStore.remove(id);
    expect(await listStore.list()).toEqual([]);
  });

  it("puts lists still to do first, the latest changed first", () => {
    const list = (id: string, done: boolean[], updatedAt: number): SavedList => ({
      id,
      title: id,
      kind: "todo",
      items: done.map((value, index) => ({ id: `${id}${index}`, text: "x", done: value })),
      createdAt: 0,
      updatedAt,
    });
    const sorted = [list("finished", [true, true], 30), list("old", [false], 10), list("new", [true, false], 20), list("empty", [], 5)].sort(compareLists);
    expect(sorted.map((item) => item.id)).toEqual(["new", "old", "empty", "finished"]);
  });
});
