import { createHash, randomBytes } from "node:crypto";

// The token of a link sent to a borrower (lib/loanShare.ts): 128 random bits
// in base64url, given once to the lender's app. Only its sha256 is stored
// (table loan_shares, 0012_loan_sharing.sql): a copy of the database alone
// opens no link.

/** A new token: 16 random bytes, 22 base64url signs. */
export const newShareToken = () => randomBytes(16).toString("base64url");

/** What is stored and looked up: the token's sha256, in hex. */
export const hashShareToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");
