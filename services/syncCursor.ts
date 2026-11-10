// Where a table's incremental sync stopped (services/rowSync.ts, `incremental`),
// kept on the device for the signed-in account: the newest server time seen,
// when everything was last read in full, and when the old removals were last
// swept. A new account, or a wiped device, starts again from nothing.

export type SyncCursor = { uid: string; at: number; fullAt: number; purgeAt: number };

const key = (table: string) => `rowsync-cursor.v1.${table}`;

export function readSyncCursor(table: string, uid: string): SyncCursor | null {
  try {
    const value = JSON.parse(localStorage.getItem(key(table)) ?? "null") as Partial<SyncCursor> | null;
    if (!value || value.uid !== uid || ![value.at, value.fullAt, value.purgeAt].every((item) => typeof item === "number")) return null;
    return value as SyncCursor;
  } catch {
    return null;
  }
}

export function writeSyncCursor(table: string, cursor: SyncCursor) {
  try {
    localStorage.setItem(key(table), JSON.stringify(cursor));
  } catch {
    // Private mode or full storage: everything is read again next time.
  }
}

/** Signing out or deleting the account: the local copy is gone, so is the memory of what it had. */
export function forgetSyncCursor(table: string) {
  try {
    localStorage.removeItem(key(table));
  } catch {
    // Nothing was kept.
  }
}
