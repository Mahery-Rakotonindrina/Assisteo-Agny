import { supabase } from "@/lib/supabase";
import { readSyncCursor, writeSyncCursor } from "./syncCursor";

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

type Row<T> = { id: string; data: T; updated_at: string; deleted_at: string | null; user_id?: string; server_updated_at?: string };

export type RowSyncOptions<T> = {
  /** Columns that pick the rows (the household's id): read with them, written with them. */
  match?: Record<string, string>;
  /** Reads who wrote each row (shared rows: the author's id; null once their account is deleted). */
  withAuthor?: (record: T, userId: string | null) => T;
  /** Only these local records are pushed (shared rows: one's own). */
  canPush?: (record: T, uid: string) => boolean;
  /** Checks a pulled record (shared rows: written by others); null skips it. */
  accept?: (record: T) => T | null;
  /**
   * Reads only what changed on the server since the last sync (its
   * `server_updated_at`, a little before to be safe), the whole table once a
   * week, and sweeps the removals older than 90 days. For tables that grow
   * (the shop). Needs the `server_updated_at` column.
   */
  incremental?: boolean;
};

/** The server's cap on the rows of one answer (Supabase's max rows). */
export const PULL_PAGE = 1000;
/** Rows written in one request. */
export const PUSH_BATCH = 200;

const time = (value: string | null) => (value ? new Date(value).getTime() : 0);

/** Incremental sync: read again from this long before the last row seen (a transaction can commit late). */
export const CURSOR_OVERLAP_MS = 5 * 60_000;
/** Incremental sync: the whole table is read again this often (the removals swept meanwhile, a clock gone wrong). */
export const FULL_READ_EVERY_MS = 7 * 24 * 3600_000;
/** Incremental sync: removals older than this are erased from the server. */
export const KEEP_REMOVALS_MS = 90 * 24 * 3600_000;
const SWEEP_EVERY_MS = 24 * 3600_000;

/** What is stored server-side: the record without device bookkeeping. */
function toData<T extends SyncedRecord>(record: T) {
  const data: Partial<T> = { ...record };
  delete data.dirty;
  delete data.deletedAt;
  return data;
}

export function createRowSync<T extends SyncedRecord>(table: string, store: SyncedStore<T>, options: RowSyncOptions<T> = {}) {
  const { match, withAuthor, canPush, accept, incremental = false } = options;
  let running: Promise<void> | null = null;

  function sync(uid: string) {
    running ??= (async () => {
      const db = supabase();
      const columns: string = [withAuthor ? "id, data, updated_at, deleted_at, user_id" : "id, data, updated_at, deleted_at", incremental ? "server_updated_at" : ""].filter(Boolean).join(", ");
      const cursor = incremental ? readSyncCursor(table, uid) : null;
      const startedAt = Date.now();
      // Whole table: the first time, then once a week; else what changed since the last sync.
      const full = !incremental || !cursor || startedAt - cursor.fullAt > FULL_READ_EVERY_MS;
      // The server answers 1000 rows at most: read page by page (a screen reset leaves many tombstones).
      const rows: Row<T>[] = [];
      for (let from = 0; ; from += PULL_PAGE) {
        let query = db.from(table).select(columns);
        if (match) query = query.match(match);
        if (incremental && !full && cursor) query = query.gt("server_updated_at", new Date(cursor.at - CURSOR_OVERLAP_MS).toISOString());
        // Same-time rows (one batch) come in a stable order from page to page.
        const ordered = incremental ? query.order("server_updated_at").order("id") : query.order("id");
        const { data, error } = await ordered.range(from, from + PULL_PAGE - 1);
        if (error) throw error;
        const page = (data ?? []) as unknown as Row<T>[];
        rows.push(...page);
        if (page.length < PULL_PAGE) break;
      }
      let changed = false;

      // A full read tells what the server no longer has (removals swept after 90 days): a local copy it never sent is gone.
      if (incremental && full) {
        const onServer = new Set(rows.map((row) => row.id));
        for (const local of await store.raw()) {
          if (!local.dirty && !onServer.has(local.id)) {
            await store.rawDelete(local.id);
            changed = true;
          }
        }
      }

      // Pull: take the server's version unless this device has a newer edit.
      for (const row of rows) {
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
          const record = withAuthor ? withAuthor(pulled, row.user_id ?? null) : pulled;
          const accepted = accept ? accept(record) : record;
          if (!accepted) continue;
          await store.rawPut(accepted);
          changed = true;
        }
      }

      if (incremental) {
        const newest = rows.reduce((latest, row) => Math.max(latest, time(row.server_updated_at ?? null)), cursor?.at ?? 0);
        let purgeAt = cursor?.purgeAt ?? 0;
        if (startedAt - purgeAt > SWEEP_EVERY_MS) {
          // Removals everyone has had time to receive: erased from the server (best effort).
          let sweep = db.from(table).delete().lt("deleted_at", new Date(startedAt - KEEP_REMOVALS_MS).toISOString());
          if (match) sweep = sweep.match(match);
          const { error: sweepError } = await sweep;
          if (!sweepError) purgeAt = startedAt;
        }
        writeSyncCursor(table, { uid, at: newest, fullAt: full ? startedAt : (cursor?.fullAt ?? startedAt), purgeAt });
      }

      // Push, a batch at a time (a screen reset marks hundreds of rows at once).
      const dirty = (await store.raw()).filter((local) => local.dirty && (!canPush || canPush(local, uid)));
      const toRow = (local: (typeof dirty)[number]) => ({
        ...match,
        user_id: uid,
        id: local.id,
        data: toData(local),
        updated_at: new Date(local.updatedAt).toISOString(),
        deleted_at: local.deletedAt ? new Date(local.deletedAt).toISOString() : null,
      });
      let refused: unknown = null;
      for (let start = 0; start < dirty.length; start += PUSH_BATCH) {
        let batch = dirty.slice(start, start + PUSH_BATCH);
        const { error: pushError } = await db.from(table).upsert(batch.map(toRow));
        if (pushError) {
          // No code: the server wasn't reached (offline), tried again next time.
          if (!pushError.code) throw pushError;
          // The server refused a row (a rule, a check): one at a time, so the
          // others still go; the refused ones stay to send.
          const sent: typeof batch = [];
          for (const local of batch) {
            const { error } = await db.from(table).upsert(toRow(local));
            if (!error) sent.push(local);
            else if (!error.code) throw error;
            else refused = error;
          }
          batch = sent;
        }
        for (const local of batch) {
          // Only clear the flag if nothing changed while uploading.
          const latest = await store.rawGet(local.id);
          if (latest && latest.updatedAt === local.updatedAt) {
            if (latest.deletedAt) await store.rawDelete(local.id);
            else await store.rawPut({ ...latest, dirty: false });
          }
        }
      }

      if (changed) store.notify();
      if (refused) throw refused;
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
