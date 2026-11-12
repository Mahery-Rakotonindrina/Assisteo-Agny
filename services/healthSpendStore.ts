import { clear, createStore, del, get, set, values } from "idb-keyval";
import { movedExpense, movedExpenseId, readHealthSpend, type HealthSpend, type HealthSpendFields } from "@/lib/healthSpending";
import { expenseStore } from "./expenseStore";
import { createId } from "./historyStore";
import { removeRecords } from "./storeRemoval";
import { forgetSyncCursor } from "./syncCursor";

// "Dépenses de santé" (Ma santé), without "Mes dépenses": one record per
// expense. Local-first like the spends; synced with the account
// (services/healthSpendSync.ts, table "health_spending"). With "Mes dépenses",
// new ones are real expenses instead; these stay. The logic lives in
// lib/healthSpending.ts.

export type { HealthSpend } from "@/lib/healthSpending";

export const HEALTH_SPEND_TABLE = "health_spending";

let store: ReturnType<typeof createStore> | null = null;
const db = () => (store ??= createStore("assisteo-health-spending", "spending"));

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

// Signed in, deletions are kept until synced so they reach the other devices.
let keepTombstones = false;

// The move to "Mes dépenses" in progress: a second tap waits for it.
let moving: Promise<number> | null = null;

async function write(spend: HealthSpend) {
  await set(spend.id, { ...spend, updatedAt: Date.now(), dirty: true }, db());
  notify();
}

export const healthSpendStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** Every health expense still there, oldest first. */
  async list(): Promise<HealthSpend[]> {
    return (await values<HealthSpend>(db()))
      .filter((spend) => !spend.deletedAt)
      .map(readHealthSpend)
      .filter((spend): spend is HealthSpend => spend !== null)
      .sort((a, b) => a.at - b.at);
  },

  /** Added; with an id of its own (a scanned receipt: receiptSpendId), the line already there is rewritten instead. */
  async add(fields: HealthSpendFields, id?: string) {
    const now = Date.now();
    const existing = id ? await get<HealthSpend>(id, db()) : undefined;
    const spend: HealthSpend = { ...fields, id: id ?? createId(), createdAt: existing && !existing.deletedAt ? existing.createdAt : now, updatedAt: now };
    await write(spend);
    return spend;
  },

  /** Changed: the fields replaced (the amount, the day, the kind, the note, whose it is). */
  async edit(id: string, fields: HealthSpendFields) {
    const current = await get<HealthSpend>(id, db());
    if (!current || current.deletedAt) return;
    await write({ id, createdAt: current.createdAt, updatedAt: current.updatedAt, ...fields });
  },

  async remove(id: string) {
    const current = await get<HealthSpend>(id, db());
    if (!current) return;
    if (keepTombstones) await write({ ...current, deletedAt: Date.now() });
    else {
      await del(id, db());
      notify();
    }
  },

  /** "Remettre à zéro" (with the rest of Ma santé): every one (synced like any removal). */
  async removeAll() {
    await removeRecords(db(), (await values<HealthSpend>(db())).filter((spend) => !spend.deletedAt), keepTombstones);
    notify();
  },

  /** A relative removed: their health expenses come back to "Moi". */
  async reassign(profileId: string) {
    for (const spend of await values<HealthSpend>(db())) {
      if (spend.profileId !== profileId || spend.deletedAt) continue;
      const { profileId: _gone, ...rest } = spend;
      await set(spend.id, { ...rest, updatedAt: Date.now(), dirty: true }, db());
    }
    notify();
  },

  /**
   * The plan has "Mes dépenses" now: each one becomes an expense of its
   * category "health" (same id every time: lib/healthSpending.ts
   * movedExpenseId), then leaves this list. Safe to run again. Returns how
   * many moved.
   */
  moveToExpenses(): Promise<number> {
    moving ??= (async () => {
      try {
        const spends = await healthSpendStore.list();
        const records = await expenseStore.list();
        for (const spend of spends) {
          const id = movedExpenseId(spend.id);
          // Not again: moved then removed in "Mes dépenses" (its removal is kept), or the receipt already typed in there.
          const removed = (await expenseStore.rawGet(id))?.deletedAt;
          const typed = spend.scanId && records.some((record) => record.kind === "expense" && record.id !== id && record.scanId === spend.scanId);
          if (!removed && !typed) await expenseStore.saveExpense(movedExpense(spend));
          await healthSpendStore.remove(spend.id);
        }
        return spends.length;
      } finally {
        moving = null;
      }
    })();
    return moving;
  },

  // ---- For the sync engine -----------------------------------------------------

  setKeepTombstones(value: boolean) {
    keepTombstones = value;
  },
  raw: () => values<HealthSpend>(db()),
  rawGet: (id: string) => get<HealthSpend>(id, db()),
  async rawPut(spend: HealthSpend) {
    await set(spend.id, spend, db());
  },
  async rawDelete(id: string) {
    await del(id, db());
  },
  notify,
  /** Signing out or deleting the account. */
  async wipe() {
    await clear(db());
    // The next sync reads everything again.
    forgetSyncCursor(HEALTH_SPEND_TABLE);
    notify();
  },
};
