import { clear, createStore, del, get, set, values } from "idb-keyval";
import { encodeImage } from "@/lib/image";
import { loanProofs, remoteFiles, withoutProof, withProof } from "@/lib/loanProof";
import { cappedRepayment, loanRemaining, MAX_INSTALLMENTS, type Installment, type Loan, type LoanDirection, type LoanInterest, type LoanProof, type Repayment } from "@/lib/loans";
import { createId } from "./historyStore";
import { loanProofStore } from "./loanProofStore";

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
  /** The pocket of "Mes poches" (none: the pockets don't move). */
  wallet?: string;
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
    wallet: cleanText(fields.wallet, 80),
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
  async addRepayment(id: string, repayment: { amountMga: number; at: number; note?: string; wallet?: string; sourceKey?: string; scanId?: string }) {
    const current = await loanStore.get(id);
    if (!current) return null;
    const amountMga = cappedRepayment(current, repayment.amountMga);
    if (amountMga === null) return null;
    const clean: Repayment = {
      id: createId(),
      at: Number.isFinite(repayment.at) ? repayment.at : Date.now(),
      amountMga,
      note: cleanText(repayment.note, 120),
      ...(repayment.wallet && { wallet: repayment.wallet }),
      ...(repayment.sourceKey && { sourceKey: repayment.sourceKey }),
      ...(repayment.scanId && { scanId: repayment.scanId }),
    };
    await change(id, (loan) => ({ ...loan, repayments: byDate([...loan.repayments, clean]) }));
    return amountMga;
  },

  /** "C'est le même": a repayment typed in by hand now stands for that line of "Mes dépenses". */
  linkRepayment: (id: string, repaymentId: string, link: { sourceKey: string; scanId?: string }) =>
    change(id, (loan) => ({
      ...loan,
      repayments: loan.repayments.map((item) => (item.id === repaymentId ? { ...item, sourceKey: link.sourceKey, linked: true as const, ...(link.scanId && { scanId: link.scanId }) } : item)),
    })),

  /** Undoes "C'est le même": the repayment typed in by hand stays, on its own. */
  unlinkRepayment: (id: string, repaymentId: string) =>
    change(id, (loan) => ({
      ...loan,
      repayments: loan.repayments.map((item) =>
        item.id === repaymentId ? { id: item.id, at: item.at, amountMga: item.amountMga, ...(item.note && { note: item.note }), ...(item.wallet && { wallet: item.wallet }) } : item,
      ),
    })),

  removeRepayment: (id: string, repaymentId: string) => change(id, (loan) => ({ ...loan, repayments: loan.repayments.filter((item) => item.id !== repaymentId) })),

  /** "Marquer comme remboursé": what is left, as one repayment. */
  async markRepaid(id: string, at = Date.now()) {
    const current = await loanStore.get(id);
    if (!current) return null;
    const left = loanRemaining(current);
    return left > 0 ? loanStore.addRepayment(id, { amountMga: left, at }) : null;
  },

  // ---- Proofs (lib/loanProof.ts): the images apart, in services/loanProofStore.ts ----

  /** A photo taken or chosen for the loan, compressed like a scan. Null when the loan has 5 proofs already. */
  async addPhotoProof(id: string, src: string) {
    const current = await loanStore.get(id);
    if (!current) return null;
    const proof: LoanProof = { id: createId(), kind: "photo", addedAt: Date.now() };
    if (!withProof(current.proofs, proof)) return null;
    // The same sizes as a scan's preview and thumbnail (lib/image.ts).
    const [preview, thumbnail] = await Promise.all([encodeImage(src, 960, 0.8), encodeImage(src, 320, 0.72)]);
    await loanProofStore.put({ id: proof.id, loanId: id, preview: preview.dataUrl, thumbnail: thumbnail.dataUrl, addedAt: proof.addedAt });
    await change(id, (loan) => ({ ...loan, proofs: withProof(loan.proofs, proof) ?? loan.proofs }));
    return proof;
  },

  /** A scan of the history ("Depuis mes scans"), not copied. Null when full, or attached already. */
  async addScanProof(id: string, scanId: string) {
    const current = await loanStore.get(id);
    if (!current) return null;
    const proof: LoanProof = { id: createId(), kind: "scan", scanId, addedAt: Date.now() };
    if (!withProof(current.proofs, proof)) return null;
    await change(id, (loan) => ({ ...loan, proofs: withProof(loan.proofs, proof) ?? loan.proofs }));
    return proof;
  },

  /** Removes a proof, its image on this device and, at the next sync, in the account. */
  async removeProof(id: string, proofId: string) {
    const current = await loanStore.get(id);
    const proof = current && loanProofs(current).find((item) => item.id === proofId);
    if (!proof) return;
    await loanProofStore.queueRemoval(remoteFiles([proof]));
    await change(id, (loan) => ({ ...loan, proofs: withoutProof(loan.proofs, proofId) }));
    if (proof.kind === "photo") await loanProofStore.remove(proof.id);
  },

  /** The sync engine stored a photo in the account. */
  setProofRemote: (id: string, proofId: string, remote: string) =>
    change(id, (loan) => ({ ...loan, proofs: loanProofs(loan).map((item) => (item.id === proofId ? { ...item, remote } : item)) })),

  async remove(id: string) {
    const current = await get<Loan>(id, db());
    if (!current) return;
    // Its proofs go with it: the images here now, the account's at the next sync.
    const proofs = loanProofs(current);
    if (proofs.length > 0) {
      await loanProofStore.queueRemoval(remoteFiles(proofs));
      await Promise.all(proofs.filter((proof) => proof.kind === "photo").map((proof) => loanProofStore.remove(proof.id)));
    }
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
    await Promise.all([clear(db()), loanProofStore.wipe()]);
    notify();
  },
};
