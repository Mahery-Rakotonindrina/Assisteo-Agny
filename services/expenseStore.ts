import { clear, createStore, del, get, set, values } from "idb-keyval";
import {
  ACTIVITY_ID,
  type ActivitySetting,
  BUDGET_ID,
  exclusionId,
  type Budget,
  type Converted,
  type CustomCategory,
  type ExpenseRecord,
  type Income,
  type ManualExpense,
  type Recurring,
  type SavingsDeposit,
  type SavingsGoal,
  type StatementTag,
  type Tontine,
  tontineFrequencies,
  type Transfer,
  type Wallet,
  type WalletPick,
  walletPickId,
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

/** A statement's tag, kept as it came (lib/statement.ts). */
const cleanTag = (tag: StatementTag | undefined): StatementTag | undefined => (tag?.name ? { name: tag.name.slice(0, 40), from: tag.from, to: tag.to } : undefined);

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
    return (await values<ExpenseRecord>(db()))
      .filter((record) => !record.deletedAt)
      .map((record) =>
        record.kind === "recurring" ? { ...record, skipped: record.skipped ?? [] } : record.kind === "savingsGoal" || record.kind === "tontine" ? { ...record, deposits: record.deposits ?? [] } : record,
      );
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
      reference: cleanText(draft.reference, 80),
      scanId: draft.scanId || undefined,
      wallet: draft.wallet || undefined,
      statement: cleanTag(draft.statement),
      ...cleanConverted(draft),
    });
  },

  async saveIncome(draft: Draft<Income>) {
    const amountMga = cleanAmount(draft.amountMga);
    if (amountMga === undefined) return null;
    return save<Income>("income", draft.id, { at: draft.at, amountMga, income: draft.income, from: draft.from, note: cleanText(draft.note, 200), sourceKey: draft.sourceKey || undefined, wallet: draft.wallet || undefined, statement: cleanTag(draft.statement), reference: cleanText(draft.reference, 80) });
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
      from: draft.from,
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

  /** Resellers: keep the reselling apart from the household's budget, or not. */
  async setActivitySeparate(separate: boolean) {
    await save<ActivitySetting>("activity", ACTIVITY_ID, { separate });
  },

  async saveCategory(draft: Draft<CustomCategory>) {
    const name = cleanText(draft.name, 40);
    if (!name) return null;
    return save<CustomCategory>("category", draft.id, { name, color: draft.color, icon: draft.icon });
  },

  // ---- Pockets (lib/wallets.ts) -----------------------------------------------------

  /** A pocket, new or changed: its name, type and starting balance (0 or more). */
  async saveWallet(draft: Draft<Wallet>) {
    const name = cleanText(draft.name, 40);
    if (!name) return null;
    const startMga = Number.isFinite(draft.startMga) ? Math.max(0, Math.round(draft.startMga)) : 0;
    return save<Wallet>("wallet", draft.id, { name, type: draft.type, startMga, startAt: draft.startAt, archived: draft.archived || undefined, primary: draft.primary || undefined });
  },

  /** The pocket used when nothing says otherwise (the others lose the mark). */
  async setPrimaryWallet(id: string) {
    for (const record of await expenseStore.list()) {
      if (record.kind !== "wallet") continue;
      const primary = record.id === id;
      if (Boolean(record.primary) !== primary) await write({ ...record, primary: primary || undefined, ...(primary && { archived: undefined }) });
    }
  },

  async setWalletArchived(id: string, archived: boolean) {
    const wallet = await current<Wallet>(id);
    if (wallet) await write({ ...wallet, archived: archived || undefined, ...(archived && { primary: undefined }) });
  },

  /** Money moved by hand between two pockets (its fees are an expense, from the first one). */
  async saveTransfer(draft: Draft<Transfer>) {
    const amountMga = cleanAmount(draft.amountMga);
    if (amountMga === undefined || !draft.from || !draft.to || draft.from === draft.to) return null;
    return save<Transfer>("transfer", draft.id, {
      from: draft.from,
      to: draft.to,
      at: draft.at,
      amountMga,
      feesMga: cleanAmount(draft.feesMga),
      note: cleanText(draft.note, 200),
      scanId: draft.scanId || undefined,
      sourceKey: draft.sourceKey || undefined,
      statement: cleanTag(draft.statement),
      reference: cleanText(draft.reference, 80),
    });
  },

  /** "My balance is really…": the difference, now (nothing when there is none). */
  async correctWallet(wallet: string, difference: number) {
    const amountMga = Math.round(difference);
    if (!wallet || !Number.isFinite(amountMga) || amountMga === 0) return null;
    return save("correction", undefined, { wallet, at: Date.now(), amountMga });
  },

  /** The pocket of a computed line (a bill, a receipt…), or back to the one it gets on its own. */
  async setWalletPick(sourceKey: string, wallet: string | null) {
    const id = walletPickId(sourceKey);
    if (wallet) await save<WalletPick>("walletPick", id, { sourceKey, wallet });
    else await expenseStore.remove(id);
  },

  /** A savings goal, new or changed (its deposits kept). */
  async saveGoal(draft: Omit<Draft<SavingsGoal>, "deposits">) {
    const name = cleanText(draft.name, 60);
    const targetMga = cleanAmount(draft.targetMga);
    if (!name || targetMga === undefined) return null;
    const existing = draft.id ? await current<SavingsGoal>(draft.id) : undefined;
    return save<SavingsGoal>("savingsGoal", draft.id, { name, targetMga, dueAt: draft.dueAt || undefined, deposits: existing?.deposits ?? [] });
  },

  /** A tontine, new or changed (its payments and pot kept). */
  async saveTontine(draft: Omit<Draft<Tontine>, "deposits" | "received">) {
    const name = cleanText(draft.name, 60);
    const amountMga = cleanAmount(draft.amountMga);
    const members = Math.round(draft.members);
    if (!name || amountMga === undefined || !Number.isFinite(members) || members < 2 || members > 100) return null;
    const existing = draft.id ? await current<Tontine>(draft.id) : undefined;
    return save<Tontine>("tontine", draft.id, {
      name,
      amountMga,
      frequency: tontineFrequencies.includes(draft.frequency) ? draft.frequency : "monthly",
      members,
      startAt: draft.startAt,
      myTurn: Math.min(members, Math.max(1, Math.round(draft.myTurn) || 1)),
      remind: draft.remind,
      deposits: existing?.deposits ?? [],
      received: existing?.received,
    });
  },

  /** Money put aside (taken back when negative), from or to a pocket, now. */
  async addDeposit(id: string, amountMga: number, wallet: string | undefined) {
    const record = await current<SavingsGoal | Tontine>(id);
    const amount = Math.round(amountMga);
    if (!record || (record.kind !== "savingsGoal" && record.kind !== "tontine") || !Number.isFinite(amount) || amount === 0) return null;
    const deposit: SavingsDeposit = { id: createId(), at: Date.now(), amountMga: amount, ...(wallet && { wallet }) };
    await write({ ...record, deposits: [...(record.deposits ?? []), deposit] });
    return deposit;
  },

  async removeDeposit(id: string, depositId: string) {
    const record = await current<SavingsGoal | Tontine>(id);
    if (record && (record.kind === "savingsGoal" || record.kind === "tontine")) await write({ ...record, deposits: (record.deposits ?? []).filter((deposit) => deposit.id !== depositId) });
  },

  /** The tontine's pot, received now into a pocket (or not received after all). */
  async setPotReceived(id: string, received: { amountMga: number; wallet?: string } | null) {
    const tontine = await current<Tontine>(id);
    if (!tontine || tontine.kind !== "tontine") return;
    const amountMga = received ? cleanAmount(received.amountMga) : undefined;
    await write({ ...tontine, received: received && amountMga ? { at: Date.now(), amountMga, ...(received.wallet && { wallet: received.wallet }) } : undefined });
  },

  /** Takes back an expense as it was (one shared with a household the user left). */
  async adopt(expense: ManualExpense) {
    await write({ ...expense, kind: "expense", deletedAt: undefined });
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
