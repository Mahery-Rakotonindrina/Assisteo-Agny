import { z } from "zod";
import { MAX_INSTALLMENTS, type Loan, type Repayment } from "./loans";

// "Prêts" of the household: a loan made or received by the family (money lent
// to a neighbour from the common budget…), seen by every member. Stored in
// table "household_loans" (0012_loan_sharing.sql) as rows of two kinds, each
// written by its author only (RLS): the loan ("loan"), and each repayment on
// it ("repayment", pointing to it by `loanId`). So any member adds a
// repayment without writing in the author's row. Never in the pockets, no
// proof, no reminder. Pure; the device store is services/householdLoanStore.ts.

/** Who wrote a row: its author's account id (none on this device before the first sync; GONE_AUTHOR once their account is deleted). */
type Authored = { userId?: string };

export type HouseholdLoanRow = Omit<Loan, "repayments" | "proofs" | "wallet" | "dirty"> & Authored & { kind: "loan"; createdAt: number; dirty?: boolean };
export type HouseholdRepaymentRow = Authored & { kind: "repayment"; id: string; loanId: string; at: number; amountMga: number; note?: string; authorName?: string; updatedAt: number; deletedAt?: number; dirty?: boolean };
export type HouseholdLoanRecord = HouseholdLoanRow | HouseholdRepaymentRow;

/** A household loan as the screens show it: its repayments gathered, each with its author. */
export type HouseholdRepayment = Repayment & Authored & { authorName?: string };

/** The author of a row whose account was deleted (user_id null on the server): read only for everyone. */
export const GONE_AUTHOR = "gone";
export type HouseholdLoan = Omit<Loan, "repayments"> & Authored & { repayments: HouseholdRepayment[] };

/** Written by this user (or on this device, before the first sync). */
export const isMineRow = (row: Authored, me: string | null) => !row.userId || row.userId === me;

const MAX_AMOUNT = 1e12;
const amount = z.number().min(0).max(MAX_AMOUNT);
const time = z.number().min(Date.UTC(2000, 0, 1)).max(Date.UTC(2100, 0, 1));
const id = z.string().min(1).max(100);
const common = { id, updatedAt: z.number(), userId: z.string().max(64).optional(), dirty: z.boolean().optional() };

const LoanRowSchema = z.object({
  ...common,
  kind: z.literal("loan"),
  createdAt: z.number().default(0),
  direction: z.enum(["lent", "borrowed"]),
  person: z.string().trim().min(1).max(60),
  phone: z.string().max(24).optional(),
  amountMga: amount.positive(),
  at: time,
  dueAt: time.optional(),
  schedule: z.array(z.object({ id, dueAt: time, amountMga: amount })).max(MAX_INSTALLMENTS).optional(),
  interest: z.object({ kind: z.enum(["fixed", "percent"]), value: z.number().min(0).max(MAX_AMOUNT) }).optional(),
  note: z.string().max(200).optional(),
});

const RepaymentRowSchema = z.object({
  ...common,
  kind: z.literal("repayment"),
  loanId: id,
  at: time,
  amountMga: amount.positive(),
  note: z.string().max(120).optional(),
  authorName: z.string().max(60).optional(),
});

const RowSchema = z.discriminatedUnion("kind", [LoanRowSchema, RepaymentRowSchema]);

/**
 * A row as it comes from the server. Each member writes their own, so the
 * others' are checked before they reach this device: unknown fields (a
 * pocket, proofs…) are dropped, a malformed row is skipped (null).
 */
export function acceptHouseholdLoanRow(record: unknown): HouseholdLoanRecord | null {
  const parsed = RowSchema.safeParse(record);
  return parsed.success ? (parsed.data as HouseholdLoanRecord) : null;
}

/** The loans with their repayments (oldest first), as lib/loans.ts works them out. Orphan repayments are left out. */
export function gatherHouseholdLoans(records: HouseholdLoanRecord[]): HouseholdLoan[] {
  const live = records.filter((record) => !record.deletedAt);
  const repayments = new Map<string, HouseholdRepayment[]>();
  for (const record of live) {
    if (record.kind !== "repayment") continue;
    const list = repayments.get(record.loanId) ?? [];
    list.push({ id: record.id, at: record.at, amountMga: record.amountMga, ...(record.note && { note: record.note }), ...(record.userId && { userId: record.userId }), ...(record.authorName && { authorName: record.authorName }) });
    repayments.set(record.loanId, list);
  }
  return live
    .filter((record): record is HouseholdLoanRow => record.kind === "loan")
    .map((row) => {
      const loan: Partial<HouseholdLoanRow> = { ...row };
      delete loan.kind;
      delete loan.createdAt;
      delete loan.dirty;
      return { ...(loan as Omit<HouseholdLoanRow, "kind" | "createdAt" | "dirty">), repayments: (repayments.get(row.id) ?? []).sort((a, b) => a.at - b.at) };
    })
    .sort((a, b) => b.at - a.at);
}

/** A household loan, taken back as a personal one (leaving the household): every repayment kept, the authors dropped. */
export function personalCopy(loan: HouseholdLoan): Loan {
  const copy: Partial<HouseholdLoan> = { ...loan };
  delete copy.userId;
  return { ...(copy as Loan), repayments: loan.repayments.map(({ id, at, amountMga, note }) => ({ id, at, amountMga, ...(note && { note }) })) };
}
