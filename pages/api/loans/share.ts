import type { NextApiRequest, NextApiResponse } from "next";
import { acceptSnapshot, isShareToken, LoanShareActionSchema, type LoanShareStatus, type SharedLoansResponse } from "@/lib/loanShare";
import { applyCors, clientIp, sendError } from "@/lib/server/http";
import { hashShareToken, newShareToken } from "@/lib/server/loanShares";
import { resolvePlan } from "@/lib/server/plan";
import { rateLimit } from "@/lib/server/rateLimit";
import { reportError } from "@/lib/server/reportError";
import { isSchemaMissing, knownMissing, noteFound, noteMissing } from "@/lib/server/schemaMissing";
import { accountsEnabled, supabaseAdmin } from "@/lib/server/supabaseAdmin";

/** Pages opened per address and minute: enough for a family, far too few to guess a 128-bit token. */
const READS_PER_MINUTE = 30;
const WRITES_PER_MINUTE = 30;
const LINKS_PER_HOUR = 20;
const HOUR_MS = 60 * 60 * 1000;

const SHARES = "loan_shares";
const HOUSEHOLD = "household_loans";
const tags = (kind: string) => ({ route: "loans/share", kind: `migration_0012_${kind}` });

/** Migration 0012 not applied: noted (reported once per instance). */
async function missing(kind: string, error: unknown) {
  if (!isSchemaMissing(error)) return false;
  await noteMissing(kind, error, Date.now(), tags(kind));
  return true;
}

/** Whether household_loans exists (0012), asked at most every few minutes once found missing. */
async function householdReady() {
  if (knownMissing(HOUSEHOLD)) return false;
  const { error } = await supabaseAdmin().from(HOUSEHOLD).select("id", { head: true }).limit(1);
  if (!error) {
    noteFound(HOUSEHOLD);
    return true;
  }
  if (await missing(HOUSEHOLD, error)) return false;
  throw error;
}

/**
 * "Partager ce qu'il reste à rendre". GET ?t=<token>: the public page's copy,
 * for anyone with the link (no account), rate limited by address; an unknown
 * token and a stopped link get the same 404. POST: the lender's app, signed
 * in: its live links and whether migration 0012 is there ("status"), a new
 * link ("create", the token given once), the copy written again ("update")
 * and "Arrêter le partage" ("revoke"). Creating and updating need "Prêts";
 * seeing and stopping one's links never do (a plan that ends must not leave
 * a link live).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse<SharedLoansResponse | LoanShareStatus | unknown>) {
  if (applyCors(req, res, ["GET", "POST"])) return;
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return sendError(res, 405, "method_not_allowed", "Use GET or POST.");
  }
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    res.setHeader("X-Robots-Tag", "noindex");
    const reads = await rateLimit(`loan-share:read:${clientIp(req)}`, READS_PER_MINUTE, 60_000);
    if (!reads.ok) {
      res.setHeader("Retry-After", String(reads.retryAfterS));
      return sendError(res, 429, "rate_limited", "Too many requests, try again in a moment.");
    }
    const notFound = () => sendError(res, 404, "not_found", "This link is not active.");
    const token = req.query.t;
    if (!isShareToken(token) || !accountsEnabled || knownMissing(SHARES)) return notFound();
    try {
      const { data, error } = await supabaseAdmin().from(SHARES).select("snapshot, updated_at").eq("token_hash", hashShareToken(token)).is("revoked_at", null).maybeSingle();
      if (error) {
        if (await missing(SHARES, error)) return notFound();
        throw error;
      }
      noteFound(SHARES);
      // Checked again on the way out: only the fields of a copy, whatever is stored.
      const snapshot = data ? acceptSnapshot(data.snapshot) : null;
      if (!data || !snapshot) return notFound();
      return res.status(200).json({ snapshot, updatedAt: String(data.updated_at) } satisfies SharedLoansResponse);
    } catch (error) {
      console.error("[loans/share]", error instanceof Error ? error.message : error);
      await reportError(error, { route: "loans/share", kind: "read" });
      return sendError(res, 500, "upstream_error", "Something went wrong.");
    }
  }

  const burst = await rateLimit(`loan-share:write:${clientIp(req)}`, WRITES_PER_MINUTE, 60_000);
  if (!burst.ok) return sendError(res, 429, "rate_limited", "Too many requests, try again in a moment.");
  if (!accountsEnabled) return sendError(res, 503, "unavailable", "Accounts are not configured.");

  const { account, features } = await resolvePlan(req);
  if (!account) return sendError(res, 401, "sign_in_required", "Sign in to share a loan.");
  const parsed = LoanShareActionSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid request.");
  const action = parsed.data;
  if ((action.action === "create" || action.action === "update") && !features.has("loans")) return sendError(res, 403, "plan_required", "Loans are not part of your plan.");
  const user = account.id;
  const db = supabaseAdmin();
  const unavailable = () => sendError(res, 503, "unavailable", "Sharing a loan is not available yet.");

  try {
    if (action.action === "status") {
      const household = await householdReady();
      if (knownMissing(SHARES)) return res.status(200).json({ ready: false, household, shares: [] } satisfies LoanShareStatus);
      const { data, error } = await db.from(SHARES).select("person, lender:snapshot->>lender").eq("user_id", user).is("revoked_at", null);
      if (error) {
        if (await missing(SHARES, error)) return res.status(200).json({ ready: false, household, shares: [] } satisfies LoanShareStatus);
        throw error;
      }
      noteFound(SHARES);
      const shares = ((data ?? []) as Array<{ person: string; lender: string | null }>).map((row) => ({ person: row.person, lender: row.lender ?? "" }));
      return res.status(200).json({ ready: true, household, shares } satisfies LoanShareStatus);
    }

    if (knownMissing(SHARES)) return unavailable();
    // Written now, whatever time the app gave.
    const now = new Date();

    if (action.action === "create") {
      const links = await rateLimit(`loan-share:create:${user}`, LINKS_PER_HOUR, HOUR_MS);
      if (!links.ok) {
        res.setHeader("Retry-After", String(links.retryAfterS));
        return sendError(res, 429, "rate_limited", "Too many links made, try again later.");
      }
      // One live link per person: a new one stops the earlier one.
      const { error: stopError } = await db.from(SHARES).update({ revoked_at: now.toISOString() }).eq("user_id", user).eq("person", action.person).is("revoked_at", null);
      if (stopError) {
        if (await missing(SHARES, stopError)) return unavailable();
        throw stopError;
      }
      const token = newShareToken();
      const { error } = await db.from(SHARES).insert({
        token_hash: hashShareToken(token),
        user_id: user,
        person: action.person,
        snapshot: { ...action.snapshot, updatedAt: now.getTime() },
        updated_at: now.toISOString(),
      });
      if (error) {
        if (await missing(SHARES, error)) return unavailable();
        throw error;
      }
      noteFound(SHARES);
      return res.status(200).json({ token });
    }

    const change = action.action === "update" ? { snapshot: { ...action.snapshot, updatedAt: now.getTime() }, updated_at: now.toISOString() } : { revoked_at: now.toISOString() };
    const { data, error } = await db.from(SHARES).update(change).eq("user_id", user).eq("person", action.person).is("revoked_at", null).select("person");
    if (error) {
      if (await missing(SHARES, error)) return unavailable();
      throw error;
    }
    noteFound(SHARES);
    return res.status(200).json({ ok: true, found: (data ?? []).length > 0 });
  } catch (error) {
    console.error("[loans/share]", error instanceof Error ? error.message : error);
    await reportError(error, { route: "loans/share", kind: action.action });
    return sendError(res, 500, "upstream_error", "Something went wrong.");
  }
}
