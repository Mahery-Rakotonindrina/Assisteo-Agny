import type { Loan, LoanProof } from "./loans";

// "Prêts": the proofs attached to a loan (a photo of the debt acknowledgment,
// a screenshot of the MVola transfer, a scan of the history). The loan only
// keeps this list; a photo's image lives on the device (services/loanProofStore.ts)
// and, with an account, in the private "scans" bucket under
// <user id>/loans/<loan id>/<proof id>.jpg (and .thumb.jpg). Pure, so it can be tested.

export const MAX_PROOFS = 5;

const isProof = (value: unknown): value is LoanProof => {
  const proof = value as Partial<LoanProof> | null;
  if (!proof || typeof proof.id !== "string" || !proof.id || !Number.isFinite(proof.addedAt)) return false;
  if (proof.kind === "scan") return typeof proof.scanId === "string" && proof.scanId !== "";
  return proof.kind === "photo";
};

/** The loan's proofs, oldest first; none for a loan saved before proofs (or without any). */
export function loanProofs(loan: Pick<Loan, "proofs">): LoanProof[] {
  if (!Array.isArray(loan.proofs)) return [];
  return loan.proofs
    .filter(isProof)
    .sort((a, b) => a.addedAt - b.addedAt)
    .slice(0, MAX_PROOFS);
}

export const hasProofs = (loan: Pick<Loan, "proofs">) => loanProofs(loan).length > 0;

export const canAddProof = (loan: Pick<Loan, "proofs">) => loanProofs(loan).length < MAX_PROOFS;

/** The list with one more proof; null when there are 5 already, or when this scan is attached already. */
export function withProof(proofs: LoanProof[] | undefined, proof: LoanProof): LoanProof[] | null {
  const current = loanProofs({ proofs });
  if (!isProof(proof) || current.length >= MAX_PROOFS) return null;
  if (current.some((item) => item.id === proof.id || (proof.kind === "scan" && item.kind === "scan" && item.scanId === proof.scanId))) return null;
  return [...current, proof];
}

/** The list without one proof (unchanged when it is not there). */
export function withoutProof(proofs: LoanProof[] | undefined, id: string): LoanProof[] {
  return loanProofs({ proofs }).filter((item) => item.id !== id);
}

/** Where a photo proof goes in the account's storage: the full photo, and its thumbnail. */
export function proofPaths(userId: string, loanId: string, proofId: string) {
  const folder = `${userId}/loans/${loanId}`;
  return { preview: `${folder}/${proofId}.jpg`, thumbnail: `${folder}/${proofId}.thumb.jpg` };
}

/** The thumbnail next to a stored photo. */
export const thumbnailPath = (remote: string) => remote.replace(/\.jpg$/, ".thumb.jpg");

/** The account's files of these proofs (photos synced already): what to remove with them. */
export function remoteFiles(proofs: LoanProof[] | undefined): string[] {
  return loanProofs({ proofs }).flatMap((proof) => (proof.kind === "photo" && proof.remote ? [proof.remote, thumbnailPath(proof.remote)] : []));
}

/** Photos taken for a loan, not in the account yet. */
export function proofsToUpload(loan: Pick<Loan, "proofs">) {
  return loanProofs(loan).filter((proof) => proof.kind === "photo" && !proof.remote);
}

/** The proofs that can go in the debt acknowledgment's annex, in order. */
export const annexProofs = (loan: Pick<Loan, "proofs">) => loanProofs(loan);
