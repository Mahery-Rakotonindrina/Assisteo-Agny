import { planFeatures, type FeatureGrant, type PlanFeature } from "@/lib/plans";
import { isSchemaMissing, knownMissing, MigrationNeededError, noteFound, noteMissing } from "./schemaMissing";
import { accountsEnabled, supabaseAdmin } from "./supabaseAdmin";

// Features offered to an e-mail for a while (supabase/migrations/0011), from
// Admin → an account's card. Only the server reads them, with the service
// role. An offer stops by itself at its end: every read compares with now.
// Before the migration, reads give nothing and writes are refused.

type Row = {
  id: string;
  email: string;
  feature: string;
  starts_at: string;
  ends_at: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

const TABLE = "table";
const table = () => supabaseAdmin().from("feature_grants");
const known = new Set<string>(planFeatures);

/** A feature removed from the app since it was offered is left out. */
const fromRows = (rows: Row[]): FeatureGrant[] =>
  rows
    .filter((row) => known.has(row.feature))
    .map((row) => ({
      id: row.id,
      email: row.email,
      feature: row.feature as PlanFeature,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      note: row.note,
      createdBy: row.created_by,
      createdAt: row.created_at,
    }));

type Result<T> = { data: T | null; error: { message: string; code?: string } | null };

/** A read: empty without accounts or before the migration (noted once, then skipped for a while). */
async function read(query: () => PromiseLike<Result<Row[]>>): Promise<FeatureGrant[]> {
  if (!accountsEnabled || knownMissing(TABLE)) return [];
  const { data, error } = await query();
  if (error) {
    if (!isSchemaMissing(error)) throw Object.assign(new Error(`feature_grants: ${error.message}`), { code: error.code });
    await noteMissing(TABLE, error);
    return [];
  }
  return fromRows(data ?? []);
}

/** A write: refused before the migration, so the admin knows it wasn't kept. */
async function write<T>(query: () => PromiseLike<Result<T>>): Promise<T> {
  const { data, error } = await query();
  if (error) {
    if (isSchemaMissing(error)) {
      await noteMissing(TABLE, error);
      throw new MigrationNeededError("0011_subscription_features");
    }
    throw Object.assign(new Error(`feature_grants: ${error.message}`), { code: error.code });
  }
  noteFound(TABLE);
  return data as T;
}

/** The offers of an e-mail not yet ended at `now` (running or planned): what `resolvePlan` needs. */
export async function currentGrantsForEmail(email: string | null | undefined, now = Date.now()) {
  if (!email) return [];
  return read(() => table().select("*").eq("email", email.toLowerCase()).gt("ends_at", new Date(now).toISOString()));
}

/** The offers not yet ended of these e-mails, in one read (the reminder cron). */
export async function currentGrantsForEmails(emails: string[], now = Date.now()) {
  if (emails.length === 0) return [];
  return read(() =>
    table()
      .select("*")
      .in(
        "email",
        emails.map((email) => email.toLowerCase()),
      )
      .gt("ends_at", new Date(now).toISOString()),
  );
}

/** Every offer of an e-mail, ended ones included, the latest first (an account's card). */
export async function grantsForEmail(email: string) {
  return read(() => table().select("*").eq("email", email.toLowerCase()).order("created_at", { ascending: false }).limit(200));
}

/** Whether offers can be kept (migration 0011 applied). */
export async function grantsReady() {
  if (!accountsEnabled) return false;
  const { error } = await table().select("id").limit(1);
  if (!error) {
    noteFound(TABLE);
    return true;
  }
  if (!isSchemaMissing(error)) throw new Error(`feature_grants: ${error.message}`);
  await noteMissing(TABLE, error);
  return false;
}

export async function getGrant(id: string) {
  const rows = await write<Row[]>(() => table().select("*").eq("id", id).limit(1));
  return fromRows(rows)[0] ?? null;
}

export async function addGrant(input: { email: string; feature: PlanFeature; startsAt: string; endsAt: string; note: string | null; createdBy: string }) {
  const rows = await write<Row[]>(() =>
    table()
      .insert({ email: input.email.trim().toLowerCase(), feature: input.feature, starts_at: input.startsAt, ends_at: input.endsAt, note: input.note, created_by: input.createdBy })
      .select("*"),
  );
  return fromRows(rows)[0];
}

/** Ends an offer now; one planned later is cut to nothing (ends right after it starts). The row stays, as the record. */
export async function stopGrant(grant: FeatureGrant, now = new Date()) {
  const start = Date.parse(grant.startsAt);
  const end = start >= now.getTime() ? new Date(start + 1000) : now;
  if (Date.parse(grant.endsAt) <= end.getTime()) return grant;
  const rows = await write<Row[]>(() => table().update({ ends_at: end.toISOString() }).eq("id", grant.id).select("*"));
  return fromRows(rows)[0] ?? grant;
}
