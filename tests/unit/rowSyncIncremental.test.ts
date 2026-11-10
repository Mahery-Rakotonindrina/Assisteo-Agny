import { beforeEach, describe, expect, it, vi } from "vitest";
import { CURSOR_OVERLAP_MS, createRowSync, FULL_READ_EVERY_MS, KEEP_REMOVALS_MS, type SyncedRecord, type SyncedStore } from "@/services/rowSync";
import { forgetSyncCursor, readSyncCursor } from "@/services/syncCursor";

// A fake Supabase table that answers what rowSync asks: rows after a time, ordered, by pages; removals older than a date erased.
type Row = { id: string; data: Record<string, unknown>; updated_at: string; deleted_at: string | null; server_updated_at: string };
const server = vi.hoisted(() => ({ rows: [] as Row[], reads: [] as Array<{ after: string | null; count: number }>, swept: [] as string[] }));
vi.mock("@/lib/supabase", () => ({
  supabase: () => ({
    from: () => ({
      select: () => {
        let after: string | null = null;
        const builder = {
          gt: (_column: string, value: string) => {
            after = value;
            return builder;
          },
          order: () => builder,
          range: async (from: number, to: number) => {
            const list = server.rows.filter((row) => !after || row.server_updated_at > after).sort((a, b) => a.server_updated_at.localeCompare(b.server_updated_at) || a.id.localeCompare(b.id));
            const page = list.slice(from, to + 1);
            if (from === 0) server.reads.push({ after, count: list.length });
            return { data: page, error: null };
          },
        };
        return builder;
      },
      upsert: async () => ({ error: null }),
      delete: () => ({
        lt: async (_column: string, value: string) => {
          server.swept.push(value);
          server.rows = server.rows.filter((row) => !(row.deleted_at && row.deleted_at < value));
          return { error: null };
        },
      }),
    }),
  }),
}));

type Item = SyncedRecord & { label?: string };

function memoryStore(initial: Item[] = []) {
  const map = new Map<string, Item>(initial.map((item) => [item.id, item]));
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

const storage = new Map<string, string>();
const iso = (time: number) => new Date(time).toISOString();
const row = (id: string, serverAt: number, extra: Partial<Row> = {}): Row => ({ id, data: { label: id }, updated_at: iso(serverAt), deleted_at: null, server_updated_at: iso(serverAt), ...extra });

beforeEach(() => {
  server.rows = [];
  server.reads = [];
  server.swept = [];
  storage.clear();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => void storage.set(key, value), removeItem: (key: string) => void storage.delete(key) });
});

describe("incremental sync", () => {
  it("reads everything the first time, then only what changed since", async () => {
    const t0 = Date.now() - 3 * 24 * 3600_000;
    server.rows = [row("a", t0), row("b", t0 + 1000)];
    const { map, store } = memoryStore();
    const sync = createRowSync<Item>("shop", store, { incremental: true });
    await sync.sync("user-1");
    expect([...map.keys()].sort()).toEqual(["a", "b"]);
    expect(server.reads.at(-1)).toMatchObject({ after: null, count: 2 });
    expect(readSyncCursor("shop", "user-1")?.at).toBe(t0 + 1000);

    // Another device adds a row long after: read from a little before the last row seen (the overlap), not from the start.
    server.rows.push(row("c", t0 + 2 * CURSOR_OVERLAP_MS));
    await sync.sync("user-1");
    expect(server.reads.at(-1)?.after).toBe(iso(t0 + 1000 - CURSOR_OVERLAP_MS));
    expect(server.reads.at(-1)?.count).toBe(3);
    expect([...map.keys()].sort()).toEqual(["a", "b", "c"]);
  });

  it("applies a removal that came after the last sync", async () => {
    const t0 = Date.now() - 24 * 3600_000;
    server.rows = [row("a", t0), row("b", t0)];
    const { map, store } = memoryStore();
    const sync = createRowSync<Item>("shop", store, { incremental: true });
    await sync.sync("user-1");
    server.rows = [row("a", t0), row("b", t0 + 3 * CURSOR_OVERLAP_MS, { deleted_at: iso(t0 + 3 * CURSOR_OVERLAP_MS) })];
    await sync.sync("user-1");
    expect([...map.keys()]).toEqual(["a"]);
  });

  it("starts again from nothing for another account, and after the device was wiped", async () => {
    const t0 = Date.now() - 24 * 3600_000;
    server.rows = [row("a", t0)];
    const { store } = memoryStore();
    const sync = createRowSync<Item>("shop", store, { incremental: true });
    await sync.sync("user-1");
    await sync.sync("user-2");
    expect(server.reads.at(-1)?.after).toBeNull();
    forgetSyncCursor("shop");
    expect(readSyncCursor("shop", "user-2")).toBeNull();
  });

  it("reads everything again after a week, and drops what the server no longer has", async () => {
    const t0 = Date.now() - 20 * 24 * 3600_000;
    server.rows = [row("a", t0), row("gone", t0)];
    const { map, store } = memoryStore();
    const sync = createRowSync<Item>("shop", store, { incremental: true });
    await sync.sync("user-1");
    // A week and more later: "gone" was removed and swept from the server, "mine" is a local change still to send.
    storage.set("rowsync-cursor.v1.shop", JSON.stringify({ uid: "user-1", at: t0, fullAt: Date.now() - FULL_READ_EVERY_MS - 1000, purgeAt: Date.now() }));
    server.rows = [row("a", t0)];
    map.set("mine", { id: "mine", updatedAt: Date.now(), dirty: true });
    await sync.sync("user-1");
    expect(server.reads.at(-1)?.after).toBeNull();
    expect([...map.keys()].sort()).toEqual(["a", "mine"]);
  });

  it("sweeps the removals older than 90 days, at most once a day", async () => {
    const now = Date.now();
    server.rows = [row("old", now - 100 * 24 * 3600_000, { deleted_at: iso(now - 95 * 24 * 3600_000) }), row("recent", now - 24 * 3600_000, { deleted_at: iso(now - 24 * 3600_000) }), row("live", now - 1000)];
    const { store } = memoryStore();
    const sync = createRowSync<Item>("shop", store, { incremental: true });
    await sync.sync("user-1");
    expect(server.rows.map((item) => item.id).sort()).toEqual(["live", "recent"]);
    expect(Date.parse(server.swept[0])).toBeLessThan(now - KEEP_REMOVALS_MS + 5000);
    await sync.sync("user-1");
    expect(server.swept).toHaveLength(1);
  });
});
