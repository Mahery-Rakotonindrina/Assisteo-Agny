import { clear, createStore, del, get, set, values } from "idb-keyval";
import { cappedRepayment, loanRemaining, MAX_INSTALLMENTS, type Installment, type Loan, type LoanDirection, type LoanInterest, type Repayment } from "@/lib/loans";
import { createId } from "./historyStore";

// "Prêts": what the user lent or borrowed, and the repayments. Local-first
// like the garage; synced with the account (services/loanSync.ts). Always
// personal (no household). The logic lives in lib/loans.ts.

export type { Loan } from "@/lib/loans";

/** What the loan form edits. */
export type LoanFields = {
  direction: LoanDirection;
  person: string;
  phone?: string;
  amountMga: number;
  at: number;
  dueAt?: number;
  /** Paid back in several times (two or more). */
  schedule?: Installment[];
  interest?: LoanInterest;
  note?: string;
};

let store: ReturnType<typeof createStore> | null = null;
const db = () => (store ??= createStore("assisteo-loans", "loans"));

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

// Signed in, deletions are kept until synced so they reach the other devices.
let keepTombstones = false;

async function write(loan: Loan) {
  await set(loan.id, { ...loan, updatedAt: Date.now(), dirty: true }, db());
  notify();
}

/** Applies a change to one loan, if it still exists. */
async function change(id: string, update: (loan: Loan) => Loan) {
  const current = await get<Loan>(id, db());
  if (!current || current.deletedAt) return;
  await write(update(normalize(current)));
}

const cleanText = (text: string | undefined, max: number) => text?.trim().replace(/\s+/g, " ").slice(0, max) || undefined;
const cleanAmount = (value: number) => (Number.isFinite(value) && value > 0 ? Math.round(value) : undefined);

/** At least two installments with a day and an amount, by day; none otherwise. */
function cleanSchedule(schedule: Installment[] | undefined) {
  if (!Array.isArray(schedule)) return undefined;
  const items = schedule
    .filter((item) => Number.isFinite(item?.dueAt) && cleanAmount(item.amountMga) !== undefined)
    .slice(0, MAX_INSTALLMENTS)
    .sort((a, b) => a.dueAt - b.dueAt)
    .map((item, index) => ({ id: typeof item.id === "string" && item.id ? item.id : `e${index + 1}`, dueAt: item.dueAt, amountMga: cleanAmount(item.amountMga)! }));
  return items.length >= 2 ? items : undefined;
}

/** A fixed amount or a share (up to 1 000 %); none when zero. */
function cleanInterest(interest: LoanInterest | undefined): LoanInterest | undefined {
  if (!interest || !Number.isFinite(interest.value) || interest.value <= 0) return undefined;
  if (interest.kind === "percent") return { kind: "percent", value: Math.min(1000, Math.round(interest.value * 100) / 100) };
  return { kind: "fixed", value: Math.round(interest.value) };
}

function cleanFields(fields: LoanFields) {
  const person = cleanText(fields.person, 60);
  const amountMga = cleanAmount(fields.amountMga);
  if (!person || amountMga === undefined) return null;
  const schedule = cleanSchedule(fields.schedule);
  return {
    direction: fields.direction === "borrowed" ? "borrowed" : "lent",
    person,
    phone: cleanText(fields.phone, 24),
    amountMga,
    at: Number.isFinite(fields.at) ? fields.at : Date.now(),
    // With a schedule, the loan is due by its last installment.
    dueAt: schedule ? schedule[schedule.length - 1].dueAt : fields.dueAt !== undefined && Number.isFinite(fields.dueAt) ? fields.dueAt : undefined,
    schedule,
    interest: cleanInterest(fields.interest),
    note: cleanText(fields.note, 200),
  } satisfies LoanFields;
}

/** Loans saved by an older version, or another device: every list present. */
function normalize(loan: Loan): Loan {
  return { ...loan, direction: loan.direction === "borrowed" ? "borrowed" : "lent", repayments: Array.isArray(loan.repayments) ? loan.repayments : [] };
}

const byDate = (items: Repayment[]) => [...items].sort((a, b) => a.at - b.at);

export const loanStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  async list(): Promise<Loan[]> {
    return (await values<Loan>(db())).filter((loan) => !loan.deletedAt).map(normalize).sort((a, b) => b.at - a.at);
  },

  async get(id: string) {
    const loan = await get<Loan>(id, db());
    return loan && !loan.deletedAt ? normalize(loan) : undefined;
  },

  /** A loan written in the app; null when the person or the amount is missing. */
  async create(fields: LoanFields) {
    const cleaned = cleanFields(fields);
    if (!cleaned) return null;
    const loan: Loan = { id: createId(), ...cleaned, repayments: [], updatedAt: Date.now() };
    await write(loan);
    return loan;
  },

  /** Corrects a loan; the repayments stay (capped to the new amount when shown). */
  async edit(id: string, fields: LoanFields) {
    const cleaned = cleanFields(fields);
    if (!cleaned) return;
    await change(id, (loan) => ({ ...loan, ...cleaned }));
  },

  /** "Il m'a rendu…" / "J'ai rendu…": capped to what is left. Returns the amount kept, null if none. */
  async addRepayment(id: string, repayment: { amountMga: number; at: number; note?: string }) {
    const current = await loanStore.get(id);
    if (!current) return null;
    const amountMga = cappedRepayment(current, repayment.amountMga);
    if (amountMga === null) return null;
    const clean: Repayment = { id: createId(), at: Number.isFinite(repayment.at) ? repayment.at : Date.now(), amountMga, note: cleanText(repayment.note, 120) };
    await change(id, (loan) => ({ ...loan, repayments: byDate([...loan.repayments, clean]) }));
    return amountMga;
  },

  removeRepayment: (id: string, repaymentId: string) => change(id, (loan) => ({ ...loan, repayments: loan.repayments.filter((item) => item.id !== repaymentId) })),

  /** "Marquer comme remboursé": what is left, as one repayment. */
  async markRepaid(id: string, at = Date.now()) {
    const current = await loanStore.get(id);
    if (!current) return null;
    const left = loanRemaining(current);
    return left > 0 ? loanStore.addRepayment(id, { amountMga: left, at }) : null;
  },

  async remove(id: string) {
    const current = await get<Loan>(id, db());
    if (!current) return;
    if (keepTombstones) await write({ ...current, deletedAt: Date.now() });
    else {
      await del(id, db());
      notify();
    }
  },

  // ---- For the sync engine -----------------------------------------------------

  setKeepTombstones(value: boolean) {
    keepTombstones = value;
  },
  raw: () => values<Loan>(db()),
  rawGet: (id: string) => get<Loan>(id, db()),
  async rawPut(loan: Loan) {
    await set(loan.id, loan, db());
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
