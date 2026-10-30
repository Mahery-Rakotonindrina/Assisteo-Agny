import { clear, createStore, del, get, set, values } from "idb-keyval";
import type { ManualExpense } from "@/lib/expenses";
import { acceptSharedExpense, isMine, sharedCategory, type HouseholdExpense } from "@/lib/household";
import { cleanAmount, expenseStore } from "./expenseStore";
import { createId } from "./historyStore";
import { createRowSync } from "./rowSync";

// The expenses shared with the household: every member's, read from table
// "household_expenses" (services/rowSync.ts, filtered by household). Each
// member only writes their own; the others' are read only. Wiped on sign-out
// and when leaving the household (one's own go back to the personal expenses).

let store: ReturnType<typeof createStore> | null = null;
const db = () => (store ??= createStore("assisteo-household-expenses", "expenses"));

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

// Signed in, deletions are kept until synced so they reach the other members.
let keepTombstones = false;

async function write(record: HouseholdExpense) {
  await set(record.id, { ...record, updatedAt: Date.now(), dirty: true }, db());
  notify();
}

export type SharedDraft = Omit<HouseholdExpense, "kind" | "createdAt" | "updatedAt" | "deletedAt" | "dirty" | "userId" | "id"> & { id?: string; createdAt?: number };

export const householdExpenseStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  async list(): Promise<HouseholdExpense[]> {
    return (await values<HouseholdExpense>(db())).filter((record) => !record.deletedAt);
  },

  /** Saves one of the user's own shared expenses (new or changed). */
  async save(draft: SharedDraft, me: string | null) {
    const amountMga = cleanAmount(draft.amountMga);
    if (amountMga === undefined) return null;
    const existing = draft.id ? await get<HouseholdExpense>(draft.id, db()) : undefined;
    if (existing && !existing.deletedAt && !isMine(existing, me)) return null;
    const now = Date.now();
    const record: HouseholdExpense = {
      kind: "expense",
      id: draft.id ?? createId(),
      at: draft.at,
      amountMga,
      category: sharedCategory(draft.category),
      note: draft.note?.trim().slice(0, 200) || undefined,
      payment: draft.payment,
      reference: draft.reference,
      scanId: draft.scanId,
      ...(draft.currency && { currency: draft.currency, originalAmount: draft.originalAmount, rate: draft.rate }),
      ...(me && { userId: me }),
      createdAt: (existing && !existing.deletedAt ? existing.createdAt : draft.createdAt) ?? now,
      updatedAt: now,
    };
    await write(record);
    return record;
  },

  async remove(id: string) {
    const record = await get<HouseholdExpense>(id, db());
    if (!record) return;
    if (keepTombstones) await write({ ...record, deletedAt: Date.now() });
    else {
      await del(id, db());
      notify();
    }
  },

  // ---- For the sync engine -----------------------------------------------------

  setKeepTombstones(value: boolean) {
    keepTombstones = value;
  },
  raw: () => values<HouseholdExpense>(db()),
  rawGet: (id: string) => get<HouseholdExpense>(id, db()),
  async rawPut(record: HouseholdExpense) {
    await set(record.id, record, db());
  },
  async rawDelete(id: string) {
    await del(id, db());
  },
  notify,
  async wipe() {
    await clear(db());
    notify();
  },
};

const sharedSync = (uid: string, householdId: string) =>
  createRowSync<HouseholdExpense>("household_expenses", householdExpenseStore, {
    match: { household_id: householdId },
    withAuthor: (record, userId) => (userId ? { ...record, userId } : record),
    canPush: (record) => isMine(record, uid),
    accept: acceptSharedExpense,
  });

/** Keeps the household's shared expenses synced while a member. Returns the stop function. */
export const startHouseholdExpenseSync = (uid: string, householdId: string) => sharedSync(uid, householdId).start(uid);

/** One sync now (before signing out). */
export const syncHouseholdExpenses = (uid: string, householdId: string) => sharedSync(uid, householdId).sync(uid);

export type ExpenseScope = "personal" | "household";

/**
 * Saves a manual expense where the user chose: personal or shared. Moving it
 * from one to the other writes it there first, then removes it here (same id):
 * never in both budgets, and never lost.
 */
export async function saveExpenseIn(scope: ExpenseScope, from: ExpenseScope | null, draft: Omit<SharedDraft, "id"> & { id?: string; sourceKey?: string }, me: string | null) {
  const moving = Boolean(draft.id && from && from !== scope);
  if (scope === "household") {
    const saved = await householdExpenseStore.save(draft, me);
    if (saved && moving) await expenseStore.remove(saved.id);
    return saved;
  }
  const saved = await expenseStore.saveExpense(draft);
  if (saved && moving) await householdExpenseStore.remove(saved.id);
  return saved;
}

/**
 * Out of the household (left, removed, or the household deleted): the user's
 * own shared expenses come back to the personal ones, the others' are dropped.
 */
export async function detachHousehold(me: string | null) {
  for (const expense of await householdExpenseStore.list()) {
    if (!isMine(expense, me)) continue;
    const personal: Partial<typeof expense> = { ...expense };
    delete personal.userId;
    delete personal.dirty;
    await expenseStore.adopt(personal as ManualExpense);
  }
  await householdExpenseStore.wipe();
}
