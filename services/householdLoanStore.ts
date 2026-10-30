import { clear, createStore, del, get, set, values } from "idb-keyval";
import { acceptHouseholdLoanRow, gatherHouseholdLoans, GONE_AUTHOR, isMineRow, personalCopy, type HouseholdLoan, type HouseholdLoanRecord, type HouseholdLoanRow, type HouseholdRepaymentRow } from "@/lib/householdLoans";
import { cappedRepayment, loanRemaining } from "@/lib/loans";
import { createId } from "./historyStore";
import { cleanLoanFields, loanStore, type LoanFields } from "./loanStore";
import { createRowSync } from "./rowSync";

// The household's loans: every member's, read from table "household_loans"
// (services/rowSync.ts, filtered by household). Loans and repayments are rows
// of their own (lib/householdLoans.ts): a member changes their own rows only,
// and adds repayments to anyone's loan. Wiped on sign-out and when leaving the
// household (one's own loans go back to the personal ones).

let store: ReturnType<typeof createStore> | null = null;
const db = () => (store ??= createStore("assisteo-household-loans", "loans"));

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

// Signed in, deletions are kept until synced so they reach the other members.
let keepTombstones = false;

async function write(record: HouseholdLoanRecord) {
  await set(record.id, { ...record, updatedAt: Date.now(), dirty: true }, db());
  notify();
}

async function drop(record: HouseholdLoanRecord) {
  if (keepTombstones) await write({ ...record, deletedAt: Date.now() });
  else {
    await del(record.id, db());
    notify();
  }
}

/** The form's fields, checked, without a pocket: the household's loans never move the personal ones. */
function cleanFields(fields: LoanFields) {
  const cleaned: Partial<ReturnType<typeof cleanLoanFields>> | null = cleanLoanFields(fields);
  if (!cleaned) return null;
  delete cleaned.wallet;
  return cleaned as Omit<NonNullable<ReturnType<typeof cleanLoanFields>>, "wallet">;
}

const live = async () => (await values<HouseholdLoanRecord>(db())).filter((record) => !record.deletedAt);

export const householdLoanStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  async list(): Promise<HouseholdLoan[]> {
    return gatherHouseholdLoans(await live());
  },

  async get(id: string) {
    return (await householdLoanStore.list()).find((loan) => loan.id === id);
  },

  /** A loan of the household, written by this member. No pocket: the household's loans never move the personal ones. */
  async create(fields: LoanFields, me: string | null) {
    const cleaned = cleanFields(fields);
    if (!cleaned) return null;
    const now = Date.now();
    const row: HouseholdLoanRow = { kind: "loan", id: createId(), ...cleaned, ...(me && { userId: me }), createdAt: now, updatedAt: now };
    await write(row);
    return (await householdLoanStore.get(row.id)) ?? null;
  },

  /** Corrects one of this member's loans; nothing for another's. */
  async edit(id: string, fields: LoanFields, me: string | null) {
    const current = await get<HouseholdLoanRecord>(id, db());
    const cleaned = cleanFields(fields);
    if (!current || current.deletedAt || current.kind !== "loan" || !isMineRow(current, me) || !cleaned) return;
    await write({ ...current, ...cleaned });
  },

  /** Any member: a repayment on any of the household's loans, capped to what is left. Returns the amount kept, null if none. */
  async addRepayment(loanId: string, repayment: { amountMga: number; at: number; note?: string }, me: string | null, authorName?: string) {
    const loan = await householdLoanStore.get(loanId);
    if (!loan) return null;
    const amountMga = cappedRepayment(loan, repayment.amountMga);
    if (amountMga === null) return null;
    const now = Date.now();
    const row: HouseholdRepaymentRow = {
      kind: "repayment",
      id: createId(),
      loanId,
      at: Number.isFinite(repayment.at) ? repayment.at : now,
      amountMga,
      ...(repayment.note?.trim() && { note: repayment.note.trim().slice(0, 120) }),
      ...(me && { userId: me }),
      // Shown as "Noté par …" even once the account is deleted.
      ...(authorName?.trim() && { authorName: authorName.trim().slice(0, 60) }),
      updatedAt: now,
    };
    await write(row);
    return amountMga;
  },

  /** "Marquer comme remboursé": what is left, as one repayment (by whoever marks it). */
  async markRepaid(loanId: string, me: string | null, authorName?: string, at = Date.now()) {
    const loan = await householdLoanStore.get(loanId);
    if (!loan) return null;
    const left = loanRemaining(loan);
    return left > 0 ? householdLoanStore.addRepayment(loanId, { amountMga: left, at }, me, authorName) : null;
  },

  /** Removes one of this member's repayments; another's stays. */
  async removeRepayment(repaymentId: string, me: string | null) {
    const record = await get<HouseholdLoanRecord>(repaymentId, db());
    if (!record || record.deletedAt || record.kind !== "repayment" || !isMineRow(record, me)) return;
    await drop(record);
  },

  /** Removes one of this member's loans, with the repayments they wrote on it (the others' are left out from then on). */
  async remove(loanId: string, me: string | null) {
    const records = await live();
    const loan = records.find((record) => record.id === loanId);
    if (!loan || loan.kind !== "loan" || !isMineRow(loan, me)) return;
    for (const record of records) if (record.kind === "repayment" && record.loanId === loanId && isMineRow(record, me)) await drop(record);
    await drop(loan);
  },

  // ---- For the sync engine -----------------------------------------------------

  setKeepTombstones(value: boolean) {
    keepTombstones = value;
  },
  raw: () => values<HouseholdLoanRecord>(db()),
  rawGet: (id: string) => get<HouseholdLoanRecord>(id, db()),
  async rawPut(record: HouseholdLoanRecord) {
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
  createRowSync<HouseholdLoanRecord>("household_loans", householdLoanStore, {
    match: { household_id: householdId },
    // A deleted account's row: never this member's, so never pushed nor changed from here.
    withAuthor: (record, userId) => ({ ...record, userId: userId ?? GONE_AUTHOR }),
    canPush: (record) => isMineRow(record, uid),
    accept: acceptHouseholdLoanRow,
  });

/** Keeps the household's loans synced while a member (once migration 0012 is there). Returns the stop function. */
export const startHouseholdLoanSync = (uid: string, householdId: string) => sharedSync(uid, householdId).start(uid);

/** One sync now (before signing out). */
export const syncHouseholdLoans = (uid: string, householdId: string) => sharedSync(uid, householdId).sync(uid);

/**
 * Out of the household (left, removed, or the household deleted): the user's
 * own loans come back to the personal ones with every repayment made on them
 * (the server does the same, with the same ids); the others' are dropped.
 */
export async function detachHouseholdLoans(me: string | null) {
  for (const loan of await householdLoanStore.list()) {
    if (isMineRow(loan, me)) await loanStore.adopt(personalCopy(loan));
  }
  await householdLoanStore.wipe();
}
