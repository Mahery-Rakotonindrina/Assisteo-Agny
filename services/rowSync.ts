import { supabase } from "@/lib/supabase";

// Syncs a small per-user collection ("Mes colis", "Mes listes") with a table
// of JSON rows (user_id, id, data, updated_at, deleted_at). A family keeps a
// handful of them, so every sync reads the whole table: the newer side wins
// per row, then local changes are pushed. Removals travel as tombstones.

export type SyncedRecord = { id: string; updatedAt: number; deletedAt?: number; dirty?: boolean };

/** What a local store exposes to the sync engine. */
export type SyncedStore<T extends SyncedRecord> = {
  raw(): Promise<T[]>;
  rawGet(id: string): Promise<T | undefined>;
  rawPut(record: T): Promise<void>;
  rawDelete(id: string): Promise<void>;
  notify(): void;
  subscribe(listener: () => void): () => void;
  setKeepTombstones(value: boolean): void;
};

type Row<T> = { id: string; data: T; updated_at: string; deleted_at: string | null; user_id?: string };

export type RowSyncOptions<T> = {
  /** Columns that pick the rows (the household's id): read with them, written with them. */
  match?: Record<string, string>;
  /** Reads who wrote each row (shared rows: the author's id). */
  withAuthor?: (record: T, userId: string) => T;
  /** Only these local records are pushed (shared rows: one's own). */
  canPush?: (record: T, uid: string) => boolean;
  /** Checks a pulled record (shared rows: written by others); null skips it. */
  accept?: (record: T) => T | null;
};

const time = (value: string | null) => (value ? new Date(value).getTime() : 0);

/** What is stored server-side: the record without device bookkeeping. */
function toData<T extends SyncedRecord>(record: T) {
  const data: Partial<T> = { ...record };
  delete data.dirty;
  delete data.deletedAt;
  return data;
}

export function createRowSync<T extends SyncedRecord>(table: string, store: SyncedStore<T>, options: RowSyncOptions<T> = {}) {
  const { match, withAuthor, canPush, accept } = options;
  let running: Promise<void> | null = null;

  function sync(uid: string) {
    running ??= (async () => {
      const db = supabase();
      const columns: string = withAuthor ? "id, data, updated_at, deleted_at, user_id" : "id, data, updated_at, deleted_at";
      const query = db.from(table).select(columns);
      const { data, error } = await (match ? query.match(match) : query);
      if (error) throw error;
      let changed = false;

      // Pull: take the server's version unless this device has a newer edit.
      for (const row of (data ?? []) as unknown as Row<T>[]) {
        const local = await store.rawGet(row.id);
        const remoteAt = time(row.updated_at);
        if (local?.dirty && local.updatedAt >= remoteAt) continue;
        if (row.deleted_at) {
          if (local) {
            await store.rawDelete(row.id);
            changed = true;
          }
        } else if (!local || local.updatedAt !== remoteAt) {
          const pulled = { ...row.data, id: row.id, updatedAt: remoteAt, dirty: false };
          const record = withAuthor && row.user_id ? withAuthor(pulled, row.user_id) : pulled;
          const accepted = accept ? accept(record) : record;
          if (!accepted) continue;
          await store.rawPut(accepted);
          changed = true;
        }
      }

      // Push.
      for (const local of await store.raw()) {
        if (!local.dirty || (canPush && !canPush(local, uid))) continue;
        const { error: pushError } = await db.from(table).upsert({
          ...match,
          user_id: uid,
          id: local.id,
          data: toData(local),
          updated_at: new Date(local.updatedAt).toISOString(),
          deleted_at: local.deletedAt ? new Date(local.deletedAt).toISOString() : null,
        });
        if (pushError) throw pushError;
        // Only clear the flag if nothing changed while uploading.
        const latest = await store.rawGet(local.id);
        if (latest && latest.updatedAt === local.updatedAt) {
          if (latest.deletedAt) await store.rawDelete(local.id);
          else await store.rawPut({ ...latest, dirty: false });
        }
      }

      if (changed) store.notify();
    })().finally(() => {
      running = null;
    });
    return running;
  }

  /** Keeps the collection synced while signed in. Returns the stop function. */
  function start(uid: string) {
    store.setKeepTombstones(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => void sync(uid).catch((error) => console.warn(`[${table}]`, error instanceof Error ? error.message : error));
    run();

    // Local edits are pushed a moment later; a pull alone never schedules another sync.
    const unsubscribe = store.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if ((await store.raw()).some((record) => record.dirty)) run();
      }, 1500);
    });
    const resume = () => document.visibilityState === "visible" && run();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", run);

    return () => {
      clearTimeout(timer);
      unsubscribe();
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", run);
      store.setKeepTombstones(false);
    };
  }

  return { sync, start };
}
