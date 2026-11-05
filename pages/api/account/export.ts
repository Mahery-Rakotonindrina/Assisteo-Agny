import type { NextApiRequest, NextApiResponse } from "next";
import {
  type AccountExport,
  type DeviceRow,
  exportDevice,
  exportGrant,
  exportSeatGiven,
  exportSeatReceived,
  exportShare,
  exportSharedRow,
  exportSubscription,
  type GrantRow,
  isoDate,
  type SeatGivenRow,
  type SeatReceivedRow,
  type SharedRow,
  type ShareRow,
  type SubscriptionRow,
} from "@/lib/accountExport";
import { maskEmail } from "@/lib/household";
import { applyCors, clientIp, sendError } from "@/lib/server/http";
import { getDiscount, parentOf, trialClaimed } from "@/lib/server/offerStore";
import { resolvePlan, type ResolvedPlan } from "@/lib/server/plan";
import { rateLimit } from "@/lib/server/rateLimit";
import { userReportsOf } from "@/lib/server/userReports";
import { reportError } from "@/lib/server/reportError";
import { accountsEnabled, supabaseAdmin, verifyAccount } from "@/lib/server/supabaseAdmin";

// "Télécharger une copie de mes données" (Réglages): what only the server
// knows about the signed-in account, added to the copy as compte.json. Every
// read is filtered on the verified account (its id or its e-mail), never on
// what the app sends. No token, no key, no admin note, nothing of the other
// members of a household (lib/accountExport.ts). A table missing (migration
// not applied) gives an empty part, never a failure.

const LIMIT = 5000;

type Filter = [column: string, value: string];

/** The rows of a table matching every filter; [] when the table is missing or the read fails. */
async function rows<T>(table: string, columns: string, filters: Filter[]): Promise<T[]> {
  try {
    let query = supabaseAdmin().from(table).select(columns);
    for (const [column, value] of filters) query = query.eq(column, value);
    const { data, error } = await query.limit(LIMIT);
    if (error) return [];
    return (data ?? []) as T[];
  } catch {
    return [];
  }
}

const alive = <T extends { deleted_at: string | null }>(list: T[]) => list.filter((row) => !row.deleted_at);

/** The plan as the app gets it (resolvePlan): a family seat's when it wins, with who offers it (masked e-mail when no name). */
export function exportPlan({ current, customPlan, seat }: Pick<ResolvedPlan, "current" | "customPlan" | "seat">): AccountExport["plan"] {
  return {
    current: current.custom ?? current.plan,
    customPlan: customPlan?.name ?? null,
    endsAt: isoDate(current.endsAt),
    from: seat ? "familySeat" : "own",
    offeredBy: seat ? (seat.owner === seat.ownerEmail ? maskEmail(seat.ownerEmail) : seat.owner) : null,
  };
}

export async function accountExport(account: { id: string; email: string }, plan: Pick<ResolvedPlan, "current" | "customPlan" | "seat">, now = Date.now()): Promise<AccountExport> {
  const { id, email } = account;
  const [subscriptions, grants, given, received, members, shares, devices, trial, discount, parent, reports] = await Promise.all([
    rows<SubscriptionRow>("subscriptions", "plan, starts_at, ends_at, amount_mga, payment_method, payment_ref, created_at", [["email", email]]),
    rows<GrantRow>("feature_grants", "feature, starts_at, ends_at", [["email", email]]),
    rows<SeatGivenRow>("family_seats", "member_email, created_at", [["owner_id", id]]),
    rows<SeatReceivedRow>("family_seats", "owner_email, owner_name, created_at", [["member_email", email]]),
    rows<{ household_id: string; role: string; joined_at: string }>("household_members", "household_id, role, joined_at", [["user_id", id]]),
    rows<ShareRow>("loan_shares", "person, created_at, updated_at, revoked_at", [["user_id", id]]),
    rows<DeviceRow>("push_devices", "platform, updated_at", [["user_id", id]]),
    trialClaimed(email).catch(() => false),
    getDiscount(email).catch(() => null),
    parentOf(email).catch(() => null),
    userReportsOf(id).catch(() => []),
  ]);

  let household: AccountExport["household"] = null;
  const membership = members[0];
  if (membership) {
    const where: Filter[] = [
      ["household_id", membership.household_id],
      ["user_id", id],
    ];
    const [homes, expenses, loans] = await Promise.all([
      rows<{ data: { name?: string } | null }>("households", "data", [["id", membership.household_id]]),
      rows<SharedRow>("household_expenses", "id, data, updated_at, deleted_at", where),
      rows<SharedRow>("household_loans", "id, data, updated_at, deleted_at", where),
    ]);
    household = {
      name: homes[0]?.data?.name ?? "",
      role: membership.role,
      joinedAt: isoDate(membership.joined_at) ?? "",
      expenses: alive(expenses).map(exportSharedRow),
      loans: alive(loans).map(exportSharedRow),
    };
  }

  return {
    email,
    exportedAt: new Date(now).toISOString(),
    plan: exportPlan(plan),
    subscriptions: subscriptions.map(exportSubscription),
    featureGrants: grants.map(exportGrant),
    offers: {
      trialUsed: trial,
      pendingDiscount: discount && { code: discount.code, percent: discount.percent, since: isoDate(discount.since) ?? "" },
      referredBy: parent ? maskEmail(parent) : null,
    },
    familySeats: { given: given.map(exportSeatGiven), received: received[0] ? exportSeatReceived(received[0]) : null },
    household,
    loanShareLinks: shares.map(exportShare),
    notificationDevices: devices.map(exportDevice),
    feedback: reports.map((report) => ({ sentAt: new Date(report.at).toISOString(), kind: report.kind, message: report.message })),
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<AccountExport | unknown>) {
  if (applyCors(req, res, ["GET"])) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return sendError(res, 405, "method_not_allowed", "Use GET.");
  }
  if (!accountsEnabled) return sendError(res, 503, "unavailable", "Accounts are not configured.");

  const limit = await rateLimit(`account-export:${clientIp(req)}`, 5, 60_000);
  if (!limit.ok) return sendError(res, 429, "rate_limited", "Too many requests, try again in a moment.");

  const account = await verifyAccount(req).catch(() => null);
  if (!account?.email) return sendError(res, 401, "sign_in_required", "Sign in to get your account's data.");

  res.setHeader("Cache-Control", "no-store");
  try {
    const plan = await resolvePlan(req);
    return res.status(200).json(await accountExport({ id: account.id, email: account.email.toLowerCase() }, plan));
  } catch (error) {
    await reportError(error, { route: "account-export" });
    return sendError(res, 500, "upstream_error", "Something went wrong.");
  }
}
