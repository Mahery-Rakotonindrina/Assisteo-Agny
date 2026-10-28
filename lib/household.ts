import { z } from "zod";
import type { ApiErrorCode } from "@/lib/ai/schema";
import { budgetLines, expenseCategories, monthKey, monthTotals, paymentMethods, type ManualExpense } from "@/lib/expenses";

// "Mes dépenses" shared with the family: a household, its members, the
// invitation codes and the expenses shared with it. Pure, so it can be tested;
// shared by the app and the server (pages/api/household.ts). The tables and
// their Row Level Security are in supabase/migrations/0009_households.sql.

// ---- Invitation codes ------------------------------------------------------------------

/** 26 signs without look-alikes (no 0/O, 1/I/L, 5/S, 8/B, Z): the same as in the migration. */
export const INVITE_ALPHABET = "234679ACDEFGHJKMNPQRTUVWXY";
export const INVITE_LENGTH = 6;
/** How long a code works. */
export const INVITE_HOURS = 48;

/** A typed code ("4k7 p2q", "4K7-P2Q"), cleaned up, or null when it can't be one. */
export function normalizeInviteCode(input: string) {
  const code = input.toUpperCase().replace(/[\s\-_.]/g, "");
  if (code.length !== INVITE_LENGTH) return null;
  return [...code].every((sign) => INVITE_ALPHABET.includes(sign)) ? code : null;
}

/** "4K7P2Q" → "4K7-P2Q", easier to read out and type. */
export const formatInviteCode = (code: string) => `${code.slice(0, 3)}-${code.slice(3)}`;

// ---- Members ----------------------------------------------------------------------------

export type HouseholdRole = "owner" | "member";
/** The cap of the shared budget, like the personal one. */
export type HouseholdBudget = { total?: number; categories: Record<string, number> };

export type HouseholdMember = { userId: string; role: HouseholdRole; joinedAt: string; label: string };

export type HouseholdInfo = {
  id: string;
  name: string;
  /** The user's own role. */
  role: HouseholdRole;
  budget: HouseholdBudget;
  members: HouseholdMember[];
  /** The live code, for the owner only. */
  invite: { code: string; expiresAt: string } | null;
};

/** What the server answers: the user's household, or null. */
export type HouseholdResponse = { userId: string; household: HouseholdInfo | null };

/** "ra…@gmail.com": enough to tell members apart, without showing the address. */
export function maskEmail(email: string | null | undefined) {
  const [local, domain] = (email ?? "").split("@");
  if (!local || !domain) return "…";
  return `${local.slice(0, Math.min(2, local.length))}…@${domain}`;
}

/** The first name when the account has one, else the masked e-mail. */
export function memberLabel({ email, name }: { email?: string | null; name?: string | null }) {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first.slice(0, 30) : maskEmail(email);
}

/** The household as the server's state function returns it, ready for the app (e-mails masked). */
export function householdFromState(state: unknown): HouseholdInfo | null {
  const parsed = StateSchema.safeParse(state);
  if (!parsed.success) return null;
  const { id, role, data, members, invite } = parsed.data;
  return {
    id,
    role,
    name: data.name ?? "",
    budget: { total: data.budget?.total, categories: data.budget?.categories ?? {} },
    members: members.map((member) => ({ userId: member.userId, role: member.role, joinedAt: member.joinedAt, label: memberLabel(member) })),
    invite: invite ?? null,
  };
}

const roleSchema = z.enum(["owner", "member"]);
const amountSchema = z.number().int().positive().max(1e12);
const BudgetSchema = z.object({
  total: amountSchema.optional(),
  categories: z.partialRecord(z.enum(expenseCategories), amountSchema).default({}),
});

const StateSchema = z.object({
  id: z.string(),
  role: roleSchema,
  data: z.object({ name: z.string().optional(), budget: BudgetSchema.partial().optional() }),
  members: z.array(z.object({ userId: z.string(), role: roleSchema, joinedAt: z.string(), email: z.string().nullish(), name: z.string().nullish() })),
  invite: z.object({ code: z.string(), expiresAt: z.string() }).nullish(),
});

// ---- What the app asks the server --------------------------------------------------------

const nameSchema = z.string().trim().min(1).max(60);

export const HouseholdActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name: nameSchema }),
  z.object({ action: z.literal("join"), code: z.string().max(20) }),
  z.object({ action: z.literal("invite") }),
  z.object({ action: z.literal("revoke") }),
  z.object({ action: z.literal("update"), name: nameSchema.optional(), budget: BudgetSchema.optional() }),
  z.object({ action: z.literal("remove"), userId: z.uuid() }),
  z.object({ action: z.literal("leave") }),
  z.object({ action: z.literal("delete") }),
]);
export type HouseholdAction = z.infer<typeof HouseholdActionSchema>;

/** The words the database functions raise, as the API's error codes and statuses. */
export const householdErrors: Record<string, { status: number; code: ApiErrorCode }> = {
  already_member: { status: 409, code: "already_member" },
  not_member: { status: 404, code: "not_member" },
  not_owner: { status: 403, code: "not_owner" },
  invalid_code: { status: 404, code: "invalid_code" },
  expired: { status: 410, code: "expired" },
  household_full: { status: 409, code: "household_full" },
  invalid_name: { status: 400, code: "invalid_request" },
};

/** The database's error word in a message ("already_member", or null). */
export function householdErrorOf(message: string | undefined) {
  const word = Object.keys(householdErrors).find((key) => message?.includes(key));
  return word ? householdErrors[word] : null;
}

/** The message key shown for a failed household request. */
export function householdErrorKey(code: string) {
  const known = ["sign_in_required", "plan_required", "already_member", "not_member", "not_owner", "invalid_code", "expired", "household_full", "rate_limited", "network"];
  return `expenses.household.errors.${known.includes(code) ? code : "failed"}`;
}

// ---- The shared expenses ------------------------------------------------------------------

/** An expense shared with the household. `userId` is its author (unset: written here, not yet synced). */
export type HouseholdExpense = Omit<ManualExpense, "sourceKey"> & { userId?: string };

/** Written by this user (or on this device, before the first sync). */
export const isMine = (expense: Pick<HouseholdExpense, "userId">, me: string | null) => !expense.userId || expense.userId === me;

const MAX_AMOUNT = 1e12;
const sharedExpenseSchema = z.object({
  id: z.string().min(1).max(100),
  kind: z.literal("expense"),
  createdAt: z.number().default(0),
  updatedAt: z.number(),
  at: z.number().min(Date.UTC(2000, 0, 1)).max(Date.UTC(2100, 0, 1)),
  amountMga: z.number().min(0).max(MAX_AMOUNT),
  category: z.string().min(1).max(80),
  note: z.string().max(500).optional(),
  payment: z.enum(paymentMethods).optional(),
  currency: z.enum(["CNY", "USD", "EUR"]).optional(),
  originalAmount: z.number().min(0).max(MAX_AMOUNT).optional(),
  rate: z.number().positive().max(1e6).optional(),
  reference: z.string().max(120).optional(),
  scanId: z.string().max(100).optional(),
  userId: z.string().max(64).optional(),
  dirty: z.boolean().optional(),
});

/**
 * A shared expense as it comes from the server. Each member writes their own
 * rows, so another member's are checked before they reach this device: unknown
 * fields are dropped, a malformed row (wrong amount, date, kind…) is skipped.
 */
export function acceptSharedExpense(record: unknown): HouseholdExpense | null {
  const parsed = sharedExpenseSchema.safeParse(record);
  return parsed.success ? parsed.data : null;
}

/** The household's month: total, by category and by member (the largest first), and its budget. */
export function householdMonth(expenses: HouseholdExpense[], month: string, budget: HouseholdBudget | undefined, me: string | null) {
  const items = expenses.filter((expense) => !expense.deletedAt && monthKey(expense.at) === month).sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  const totals = monthTotals(items.map((expense) => ({ amountMga: expense.amountMga, category: expense.category, excluded: false })));
  const members = new Map<string, number>();
  for (const expense of items) {
    const author = isMine(expense, me) ? (me ?? "") : expense.userId!;
    members.set(author, (members.get(author) ?? 0) + expense.amountMga);
  }
  return {
    items,
    totals,
    byMember: [...members.entries()].map(([userId, amount]) => ({ userId, amount })).sort((a, b) => b.amount - a.amount),
    budget: budgetLines(budget, totals),
  };
}

/** A shared expense uses a built-in category (the members can't see each other's own ones). */
export const sharedCategory = (category: string) => ((expenseCategories as readonly string[]).includes(category) ? category : "other");
