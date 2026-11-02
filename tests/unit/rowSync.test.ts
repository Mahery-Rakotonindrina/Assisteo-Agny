import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRowSync, type SyncedRecord, type SyncedStore } from "@/services/rowSync";

// What the server got and how it answers (services/rowSync.ts writes through supabase()).
const server = vi.hoisted(() => ({ upserts: [] as string[][], refuse: new Set<string>(), offline: false }));
vi.mock("@/lib/supabase", () => ({
  supabase: () => ({
    from: () => ({
      select: () => ({ order: () => ({ range: async () => ({ data: [], error: null }) }) }),
      upsert: async (rows: { id: string } | { id: string }[]) => {
        const list = Array.isArray(rows) ? rows : [rows];
        server.upserts.push(list.map((row) => row.id));
        if (server.offline) return { error: { message: "TypeError: Failed to fetch", code: "" } };
        const refused = list.some((row) => server.refuse.has(row.id));
        return { error: refused ? { message: "new row violates row-level security policy", code: "42501" } : null };
      },
    }),
  }),
}));

type Item = SyncedRecord & { label: string };

function memoryStore(ids: string[]) {
  const map = new Map<string, Item>(ids.map((id) => [id, { id, label: id, updatedAt: 1, dirty: true }]));
  const store: SyncedStore<Item> = {
    raw: async () => [...map.values()],
    rawGet: async (id) => map.get(id),
    rawPut: async (record) => void map.set(record.id, record),
    rawDelete: async (id) => void map.delete(id),
    notify: () => undefined,
    subscribe: () => () => undefined,
    setKeepTombstones: () => undefined,
  };
  return { map, store };
}

beforeEach(() => {
  server.upserts = [];
  server.refuse = new Set();
  server.offline = false;
});

describe("pushing local changes", () => {
  it("sends the others when the server refuses one row; the refused one stays to send", async () => {
    const { map, store } = memoryStore(["a", "bad", "c"]);
    server.refuse.add("bad");
    await expect(createRowSync("parcels", store).sync("user-1")).rejects.toMatchObject({ code: "42501" });
    expect(server.upserts).toEqual([["a", "bad", "c"], ["a"], ["bad"], ["c"]]);
    expect([...map.values()].map((item) => `${item.id}:${item.dirty}`)).toEqual(["a:false", "bad:true", "c:false"]);
  });

  it("offline, tries nothing row by row and keeps every change to send", async () => {
    const { map, store } = memoryStore(["a", "b"]);
    server.offline = true;
    await expect(createRowSync("parcels", store).sync("user-1")).rejects.toMatchObject({ code: "" });
    expect(server.upserts).toEqual([["a", "b"]]);
    expect([...map.values()].every((item) => item.dirty)).toBe(true);
  });
});
