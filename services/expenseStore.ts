import { clear, createStore, del, get, set, values } from "idb-keyval";
import {
  BUDGET_ID,
  exclusionId,
  type Budget,
  type Converted,
  type CustomCategory,
  type ExpenseRecord,
  type Income,
  type ManualExpense,
  type Recurring,
} from "@/lib/expenses";
import { createId } from "./historyStore";

// "Mes dépenses": expenses, incomes, recurring items, the budget, custom
// categories and exclusions, one record each. Local-first like the garage;
// synced with the account (services/expenseSync.ts, table "expenses"). The
// logic lives in lib/expenses.ts.

export type { ExpenseRecord } from "@/lib/expenses";

let store: ReturnType<typeof createStore> | null = null;
const db = () => (store ??= createStore("assisteo-expenses", "expenses"));

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

// Signed in, deletions are kept until synced so they reach the other devices.
let keepTombstones = false;

async function write(record: ExpenseRecord) {
  await set(record.id, { ...record, updatedAt: Date.now(), dirty: true }, db());
  notify();
}

async function current<T extends ExpenseRecord>(id: string) {
  const record = await get<T>(id, db());
  return record && !record.deletedAt ? record : undefined;
}

const cleanText = (text: string | undefined, max = 120) => text?.trim().slice(0, max) || undefined;

/** A whole, positive number of ariary, else none. */
export const cleanAmount = (value: number | undefined) => (value !== undefined && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined);

function cleanConverted({ currency, originalAmount, rate }: Converted): Converted {
  if (!currency || !originalAmount || !rate || originalAmount <= 0 || rate <= 0) return {};
  return { currency, originalAmount: Math.round(originalAmount * 100) / 100, rate: Math.round(rate * 10000) / 10000 };
}

type Draft<T> = Omit<T, "id" | "kind" | "createdAt" | "updatedAt" | "deletedAt" | "dirty"> & { id?: string };

/** Saves a new record, or a change to an existing one (keeping its creation time). */
async function save<T extends ExpenseRecord>(kind: T["kind"], id: string | undefined, fields: object) {
  const now = Date.now();
  const existing = id ? await current<T>(id) : undefined;
  const record = { ...fields, kind, id: id ?? createId(), createdAt: existing?.createdAt ?? now, updatedAt: now } as T;
  await write(record);
  return record;
}

export const expenseStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  async list(): Promise<ExpenseRecord[]> {
    return (await values<ExpenseRecord>(db())).filter((record) => !record.deletedAt).map((record) => (record.kind === "recurring" ? { ...record, skipped: record.skipped ?? [] } : record));
  },

  async saveExpense(draft: Draft<ManualExpense>) {
    const amountMga = cleanAmount(draft.amountMga);
    if (amountMga === undefined) return null;
    return save<ManualExpense>("expense", draft.id, {
      at: draft.at,
      amountMga,
      category: draft.category || "other",
      note: cleanText(draft.note, 200),
      payment: draft.payment,
      sourceKey: draft.sourceKey || undefined,
      ...cleanConverted(draft),
    });
  },

  async saveIncome(draft: Draft<Income>) {
    const amountMga = cleanAmount(draft.amountMga);
    if (amountMga === undefined) return null;
    return save<Income>("income", draft.id, { at: draft.at, amountMga, income: draft.income, note: cleanText(draft.note, 200), sourceKey: draft.sourceKey || undefined });
  },

  async saveRecurring(draft: Draft<Recurring>) {
    const amountMga = cleanAmount(draft.amountMga);
    if (amountMga === undefined) return null;
    return save<Recurring>("recurring", draft.id, {
      flow: draft.flow,
      label: cleanText(draft.label, 80) ?? "",
      amountMga,
      category: draft.category || "other",
      day: Math.min(31, Math.max(1, Math.round(draft.day) || 1)),
      startMonth: draft.startMonth,
      endMonth: draft.endMonth,
      payment: draft.payment,
      remind: draft.remind,
      skipped: draft.skipped ?? [],
    });
  },

  /** "Not this month" for a recurring item, or back again. */
  async setSkipped(id: string, month: string, skipped: boolean) {
    const recurring = await current<Recurring>(id);
    if (!recurring) return;
    const rest = (recurring.skipped ?? []).filter((item) => item !== month);
    await write({ ...recurring, skipped: skipped ? [...rest, month] : rest });
  },

  /** The monthly caps: overall and per category (an empty cap removes it). */
  async setBudget(total: number | undefined, categories: Record<string, number | undefined>) {
    const kept = Object.fromEntries(Object.entries(categories).flatMap(([key, value]) => (cleanAmount(value) ? [[key, cleanAmount(value)!]] : [])));
    await save<Budget>("budget", BUDGET_ID, { total: cleanAmount(total), categories: kept });
  },

  async saveCategory(draft: Draft<CustomCategory>) {
    const name = cleanText(draft.name, 40);
    if (!name) return null;
    return save<CustomCategory>("category", draft.id, { name, color: draft.color, icon: draft.icon });
  },

  /** Keeps a computed expense (a bill, a fill…) out of the budget, or back in. */
  async setExcluded(sourceKey: string, excluded: boolean) {
    const id = exclusionId(sourceKey);
    if (excluded) await save("exclusion", id, { sourceKey });
    else await expenseStore.remove(id);
  },

  async remove(id: string) {
    const record = await get<ExpenseRecord>(id, db());
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
  raw: () => values<ExpenseRecord>(db()),
  rawGet: (id: string) => get<ExpenseRecord>(id, db()),
  async rawPut(record: ExpenseRecord) {
    await set(record.id, record, db());
  },
  async rawDelete(id: string) {
    await del(id, db());
  },
  notify,
  /** Signing out or deleting the account. */
  async wipe() {
    await clear(db());
    notify();
  },
};
