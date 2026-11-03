import { maskEmail } from "./household";

// "Télécharger une copie de mes données": what only the server knows about
// an account (pages/api/account/export.ts), shaped here so the route and its
// test share it. Never a token, a key, an admin note or another person's
// data: other people's e-mails are masked, the household gives only its name.

export type AccountExport = {
  email: string;
  exportedAt: string;
  plan: { current: string; customPlan: { fr: string; en: string } | null; endsAt: string | null };
  subscriptions: Array<{ plan: string; startsAt: string; endsAt: string | null; amountMga: number | null; paymentMethod: string | null; paymentRef: string | null; recordedAt: string }>;
  /** Features given for a while from the Admin (without its note nor who gave them). */
  featureGrants: Array<{ feature: string; startsAt: string; endsAt: string }>;
  offers: { trialUsed: boolean; pendingDiscount: { code: string; percent: number; since: string } | null; referredBy: string | null };
  familySeats: { given: Array<{ member: string; since: string }>; received: { owner: string; since: string } | null };
  /** The household: its name, one's role, and only one's own shared lines. */
  household: { name: string; role: string; joinedAt: string; expenses: unknown[]; loans: unknown[] } | null;
  /** The loans' share links made by the account: no token (the server keeps only its hash anyway). */
  loanShareLinks: Array<{ person: string; createdAt: string; updatedAt: string; active: boolean }>;
  /** The devices that receive reminders: no token nor key. */
  notificationDevices: Array<{ platform: string; updatedAt: string }>;
};

const iso = (value: string | number | null | undefined) => (value === null || value === undefined || value === "" ? null : new Date(value).toISOString());
const isoOr = (value: string | number | null | undefined) => iso(value) ?? new Date(0).toISOString();

// ---- Shaping the rows ---------------------------------------------------------------

export type SubscriptionRow = { plan: string; starts_at: string; ends_at: string | null; amount_mga: number | null; payment_method: string | null; payment_ref: string | null; created_at: string };
export const exportSubscription = (row: SubscriptionRow) => ({
  plan: row.plan,
  startsAt: isoOr(row.starts_at),
  endsAt: iso(row.ends_at),
  amountMga: row.amount_mga,
  paymentMethod: row.payment_method,
  paymentRef: row.payment_ref,
  recordedAt: isoOr(row.created_at),
});

export type GrantRow = { feature: string; starts_at: string; ends_at: string };
export const exportGrant = (row: GrantRow) => ({ feature: row.feature, startsAt: isoOr(row.starts_at), endsAt: isoOr(row.ends_at) });

export type SeatGivenRow = { member_email: string; created_at: string };
export const exportSeatGiven = (row: SeatGivenRow) => ({ member: maskEmail(row.member_email), since: isoOr(row.created_at) });

export type SeatReceivedRow = { owner_email: string; owner_name: string | null; created_at: string };
export const exportSeatReceived = (row: SeatReceivedRow) => ({ owner: row.owner_name?.trim() || maskEmail(row.owner_email), since: isoOr(row.created_at) });

export type ShareRow = { person: string; created_at: string; updated_at: string; revoked_at: string | null };
export const exportShare = (row: ShareRow) => ({ person: row.person, createdAt: isoOr(row.created_at), updatedAt: isoOr(row.updated_at), active: !row.revoked_at });

export type DeviceRow = { platform: string; updated_at: string };
export const exportDevice = (row: DeviceRow) => ({ platform: row.platform, updatedAt: isoOr(row.updated_at) });

/** A synced row (expenses, loans shared with the household): its data, its dates, never its author's id. */
export type SharedRow = { id: string; data: Record<string, unknown> | null; updated_at: string; deleted_at: string | null };
export function exportSharedRow(row: SharedRow) {
  const { userId: _author, ...data } = row.data ?? {};
  return { ...data, id: row.id, updatedAt: isoOr(row.updated_at) };
}

export { iso as isoDate };
