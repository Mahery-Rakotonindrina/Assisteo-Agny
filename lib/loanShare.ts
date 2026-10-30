import { z } from "zod";
import { loanInterest, personKey, type Installment, type Loan, type Repayment } from "./loans";

// "Partager ce qu'il reste à rendre": a frozen copy of what one person owes
// the user, read by that person on a public page (pages/pret.tsx) through
// pages/api/loans/share.ts. Only what the borrower needs goes in: the two
// names, and for each loan its amounts, schedule and repayments. Never a
// phone, an e-mail, a note, a proof, a pocket or another person. Pure, shared
// by the app and the server; the token is made on the server (lib/server/loanShares.ts).

/** One loan as the borrower sees it. */
export type SharedLoan = {
  amountMga: number;
  /** The interest or fees agreed, worked out in ariary (0 without). */
  interestMga: number;
  at: number;
  dueAt?: number;
  schedule?: Array<{ dueAt: number; amountMga: number }>;
  repayments: Array<{ at: number; amountMga: number }>;
};

export type LoanShareSnapshot = {
  v: 1;
  /** The lender's name, as they chose to show it. */
  lender: string;
  borrower: string;
  /** When the copy was last written. */
  updatedAt: number;
  loans: SharedLoan[];
};

const MAX_AMOUNT = 1e12;
const amount = z.number().int().min(0).max(MAX_AMOUNT);
const time = z.number().min(Date.UTC(2000, 0, 1)).max(Date.UTC(2100, 0, 1));
const name = z.string().trim().min(1).max(60);

// Unknown keys are dropped (zod strips them): whatever a client sends, only these fields are kept and served.
const SharedLoanSchema = z.object({
  amountMga: amount,
  interestMga: amount,
  at: time,
  dueAt: time.optional(),
  schedule: z.array(z.object({ dueAt: time, amountMga: amount })).max(36).optional(),
  repayments: z.array(z.object({ at: time, amountMga: amount })).max(200),
});

export const LoanShareSnapshotSchema = z.object({
  v: z.literal(1),
  lender: name,
  borrower: name,
  updatedAt: time,
  loans: z.array(SharedLoanSchema).min(1).max(50),
});

/** A person's key, as lib/loans.ts personKey makes it. */
const PersonSchema = z.string().trim().min(1).max(120);

/** What the app asks the server (POST /api/loans/share), signed in. */
export const LoanShareActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status") }),
  z.object({ action: z.literal("create"), person: PersonSchema, snapshot: LoanShareSnapshotSchema }),
  z.object({ action: z.literal("update"), person: PersonSchema, snapshot: LoanShareSnapshotSchema }),
  z.object({ action: z.literal("revoke"), person: PersonSchema }),
]);
export type LoanShareAction = z.infer<typeof LoanShareActionSchema>;

/** The server's answer to "status": whether migration 0012 is there, and the user's live links. */
export type LoanShareStatus = { ready: boolean; household: boolean; shares: Array<{ person: string; lender: string }> };
/** What the public page reads (GET /api/loans/share?t=…). */
export type SharedLoansResponse = { snapshot: LoanShareSnapshot; updatedAt: string };

/** A token as the server makes them: 16 random bytes in base64url. */
export const isShareToken = (token: unknown): token is string => typeof token === "string" && /^[A-Za-z0-9_-]{22}$/.test(token);

/** The token of the page's address ("?t="), or null when it is missing or cut short: nothing is asked then. */
export function shareTokenFrom(value: string | string[] | undefined) {
  const token = Array.isArray(value) ? value[0] : value;
  return isShareToken(token) ? token : null;
}

/** The link sent to the borrower. */
export const shareUrl = (base: string, token: string) => `${base.replace(/\/$/, "")}/pret?t=${encodeURIComponent(token)}`;

/** A copy as the server keeps it: checked, unknown fields dropped; null when malformed. */
export function acceptSnapshot(value: unknown): LoanShareSnapshot | null {
  const parsed = LoanShareSnapshotSchema.safeParse(value);
  return parsed.success ? (parsed.data as LoanShareSnapshot) : null;
}

/**
 * The copy of what `key` owes the user ("On me doit" only), or null when no
 * loan is left for them. Built field by field: nothing else of a loan goes in.
 */
export function shareSnapshot(loans: Loan[], key: string, lender: string, now: number): LoanShareSnapshot | null {
  const theirs = loans.filter((loan) => !loan.deletedAt && loan.direction === "lent" && personKey(loan.person) === key).sort((a, b) => a.at - b.at);
  const lenderName = lender.trim().replace(/\s+/g, " ").slice(0, 60);
  if (theirs.length === 0 || !lenderName) return null;
  const latest = [...theirs].sort((a, b) => b.at - a.at || b.updatedAt - a.updatedAt)[0];
  return {
    v: 1,
    lender: lenderName,
    borrower: latest.person.trim().slice(0, 60),
    updatedAt: now,
    loans: theirs.slice(-50).map((loan) => ({
      amountMga: Math.round(loan.amountMga),
      interestMga: loanInterest(loan),
      at: loan.at,
      ...(loan.dueAt !== undefined && { dueAt: loan.dueAt }),
      ...(loan.schedule && loan.schedule.length > 0 && { schedule: loan.schedule.map((item) => ({ dueAt: item.dueAt, amountMga: Math.round(item.amountMga) })) }),
      repayments: (loan.repayments ?? []).filter((item) => item.amountMga > 0).map((item) => ({ at: item.at, amountMga: Math.round(item.amountMga) })),
    })),
  };
}

/** The same content (the time it was written aside): no need to write it again. */
export const sameSnapshot = (a: LoanShareSnapshot | null | undefined, b: LoanShareSnapshot | null | undefined) =>
  Boolean(a && b) && JSON.stringify({ ...a, updatedAt: 0 }) === JSON.stringify({ ...b, updatedAt: 0 });

/** A shared loan, in the form lib/loans.ts works out what is left, late and next due from. */
export function sharedAsLoan(loan: SharedLoan) {
  const schedule: Installment[] | undefined = loan.schedule?.map((item, index) => ({ id: `e${index + 1}`, ...item }));
  const repayments: Repayment[] = loan.repayments.map((item, index) => ({ id: `r${index + 1}`, ...item }));
  return {
    amountMga: loan.amountMga,
    interest: loan.interestMga > 0 ? { kind: "fixed" as const, value: loan.interestMga } : undefined,
    dueAt: loan.dueAt,
    schedule,
    repayments,
  } satisfies Pick<Loan, "amountMga" | "interest" | "dueAt" | "schedule" | "repayments">;
}
