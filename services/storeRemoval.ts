import { delMany, setMany, type UseStore } from "idb-keyval";
import type { SyncedRecord } from "./rowSync";

/**
 * Removes many records of a synced store at once ("Remettre à zéro"): signed
 * in, tombstones the sync pushes (by batches, services/rowSync.ts) so the
 * other devices remove them too; signed out, gone. The caller notifies once.
 */
export async function removeRecords<T extends SyncedRecord>(db: UseStore, records: T[], keepTombstones: boolean) {
  if (records.length === 0) return;
  if (keepTombstones) {
    const now = Date.now();
    await setMany(
      records.map((record) => [record.id, { ...record, deletedAt: now, updatedAt: now, dirty: true }]),
      db,
    );
  } else {
    await delMany(
      records.map((record) => record.id),
      db,
    );
  }
}
