import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { mockAnalysis } from "@/lib/ai/mock";
import { historyStore } from "@/services/historyStore";
import { compactOldPhotos, entryPhotoBytes, FULL_PHOTOS_KEPT } from "@/services/photoStorage";
import type { HistoryEntry } from "@/types/history";

const jpeg = (bytes: number) => `data:image/jpeg;base64,${"A".repeat(Math.ceil((bytes * 4) / 3))}`;

function entry(index: number, synced: boolean): HistoryEntry {
  return {
    id: `scan-${index}`,
    createdAt: 1_000_000 + index,
    mode: "food",
    thumbnail: jpeg(20_000),
    preview: jpeg(150_000),
    analysis: mockAnalysis("food", "fr"),
    meta: { model: "demo", demo: true, durationMs: 1 },
    dirty: !synced,
    ...(synced && { remote: { preview: `u/scan-${index}/preview.jpg`, thumbnail: `u/scan-${index}/thumbnail.jpg` } }),
  };
}

describe("compactOldPhotos", () => {
  beforeEach(async () => {
    await historyStore.wipe();
  });

  it("keeps the most recent full photos and shrinks the older ones", async () => {
    const total = FULL_PHOTOS_KEPT + 3;
    // The three oldest: one never synced, two already in the account.
    for (let index = 0; index < total; index++) await historyStore.rawPut(entry(index, index !== 0), { silent: true });

    expect(await compactOldPhotos()).toBe(3);
    const all = await historyStore.raw();
    const byId = new Map(all.map((item) => [item.id, item]));

    for (const index of [0, 1, 2]) {
      const old = byId.get(`scan-${index}`)!;
      expect(old.preview).toBe(old.thumbnail);
      expect(entryPhotoBytes(old)).toBeLessThan(25_000);
    }
    // Synced ones must shrink in the account too.
    expect(byId.get("scan-1")).toMatchObject({ compactRemote: true, dirty: true });
    expect(byId.get("scan-0")?.compactRemote).toBeUndefined();
    // Recent ones untouched.
    expect(byId.get(`scan-${total - 1}`)!.preview).not.toBe(byId.get(`scan-${total - 1}`)!.thumbnail);

    expect(await compactOldPhotos()).toBe(0);
  });

  it("does nothing while the history is short", async () => {
    for (let index = 0; index < 5; index++) await historyStore.rawPut(entry(index, true), { silent: true });
    expect(await compactOldPhotos()).toBe(0);
  });
});
