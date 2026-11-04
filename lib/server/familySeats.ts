import { isSchemaMissing, knownMissing, MigrationNeededError, noteFound, noteMissing } from "./schemaMissing";
import { accountsEnabled, supabaseAdmin } from "./supabaseAdmin";

// Family seats (supabase/migrations/0016_places_famille.sql): the people a
// subscriber shares their plan with. Only the server writes them, with the
// service role, after checking the subscriber's plan. Before the migration,
// reads give nothing (the plan works as before) and writes are refused.
// A seat is an invitation until the person accepts it (`accepted_at`,
// migration 0019): a pending seat counts against the subscriber's seats but
// gives the person nothing. Before 0019 there is no column and every seat
// counts as accepted, as it always did.

export const FAMILY_MIGRATION = "0016_places_famille";

type Row = {
  id: string;
  owner_id: string;
  owner_email: string;
  owner_name: string | null;
  member_email: string;
  created_at: string;
  /** Absent before migration 0019; null while the invitation waits. */
  accepted_at?: string | null;
};

/** `pending`: invited, not accepted yet. */
export type SeatRow = { id: string; ownerId: string; ownerEmail: string; ownerName: string | null; memberEmail: string; createdAt: number; pending: boolean };

const TABLE = "family_seats";
const table = () => supabaseAdmin().from("family_seats");
const tags = { route: "plan", kind: "migration_0016_family_seats" };

/** Only a null `accepted_at` is an invitation: no column (before 0019) means an accepted seat. */
export const isPending = (row: Pick<Row, "accepted_at">) => row.accepted_at === null;

const fromRow = (row: Row): SeatRow => ({
  id: row.id,
  ownerId: row.owner_id,
  ownerEmail: row.owner_email,
  ownerName: row.owner_name,
  memberEmail: row.member_email,
  createdAt: Date.parse(row.created_at),
  pending: isPending(row),
});

type Result<T> = { data: T | null; error: { message: string; code?: string } | null };

/** A write, or a read the subscriber asked for: refused before the migration (409 for the screen). */
async function strict<T>(query: () => PromiseLike<Result<T>>): Promise<T> {
  if (!accountsEnabled) throw new MigrationNeededError(FAMILY_MIGRATION);
  const { data, error } = await query();
  if (error) {
    if (isSchemaMissing(error)) {
      await noteMissing(TABLE, error, Date.now(), tags);
      throw new MigrationNeededError(FAMILY_MIGRATION);
    }
    throw Object.assign(new Error(`family_seats: ${error.message}`), { code: error.code });
  }
  noteFound(TABLE);
  return data as T;
}

/** The seat an e-mail holds, for `resolvePlan`: null without accounts, before the migration (noted once, then skipped for a while) or while the invitation is not accepted. */
export async function seatForMember(email: string | null | undefined): Promise<SeatRow | null> {
  if (!email || !accountsEnabled || knownMissing(TABLE)) return null;
  const { data, error } = await table().select("*").eq("member_email", email.toLowerCase()).limit(1);
  if (error) {
    if (!isSchemaMissing(error)) throw Object.assign(new Error(`family_seats: ${error.message}`), { code: error.code });
    await noteMissing(TABLE, error, Date.now(), tags);
    return null;
  }
  const row = (data as Row[] | null)?.[0];
  return row && !isPending(row) ? fromRow(row) : null;
}

/** The seats of a subscriber, the earliest first. */
export async function seatsOfOwner(ownerId: string): Promise<SeatRow[]> {
  return (await strict<Row[]>(() => table().select("*").eq("owner_id", ownerId).order("created_at", { ascending: true }).limit(100))).map(fromRow);
}

/** The seat or invitation an e-mail holds (see `pending`), for the screen and the Admin: refused before the migration. */
export async function memberSeat(email: string): Promise<SeatRow | null> {
  const rows = await strict<Row[]>(() => table().select("*").eq("member_email", email.toLowerCase()).limit(1));
  return rows[0] ? fromRow(rows[0]) : null;
}

/** The seats given by an e-mail (Admin → an account's card). */
export async function seatsGivenBy(email: string): Promise<SeatRow[]> {
  return (await strict<Row[]>(() => table().select("*").eq("owner_email", email.toLowerCase()).order("created_at", { ascending: true }).limit(100))).map(fromRow);
}

/**
 * The seats of these e-mails and every seat of their subscribers (to rank
 * them), in two reads (the reminder cron): none before the migration.
 */
export async function seatsForMembers(emails: string[]): Promise<SeatRow[]> {
  if (emails.length === 0 || !accountsEnabled || knownMissing(TABLE)) return [];
  const { data, error } = await table()
    .select("*")
    .in(
      "member_email",
      emails.map((email) => email.toLowerCase()),
    );
  if (error) {
    if (!isSchemaMissing(error)) throw Object.assign(new Error(`family_seats: ${error.message}`), { code: error.code });
    await noteMissing(TABLE, error, Date.now(), tags);
    return [];
  }
  // An invitation not accepted gives nothing: its subscriber's seats are not read for it.
  const owners = [...new Set(((data as Row[] | null) ?? []).filter((row) => !isPending(row)).map((row) => row.owner_id))];
  if (owners.length === 0) return [];
  return (await strict<Row[]>(() => table().select("*").in("owner_id", owners).limit(5000))).map(fromRow);
}

/** Thrown when the person already holds a seat (one seat per person, kept by the database too). */
export class SeatTakenError extends Error {
  constructor() {
    super("This person already holds a family seat.");
    this.name = "SeatTakenError";
  }
}

export async function addSeat(input: { ownerId: string; ownerEmail: string; ownerName: string | null; memberEmail: string }) {
  try {
    const rows = await strict<Row[]>(() =>
      table()
        .insert({ owner_id: input.ownerId, owner_email: input.ownerEmail.toLowerCase(), owner_name: input.ownerName, member_email: input.memberEmail.trim().toLowerCase() })
        .select("*"),
    );
    return fromRow(rows[0]);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new SeatTakenError();
    throw error;
  }
}

/** Frees a seat now; only the subscriber's own (`ownerId`). Returns the seat removed, or null. */
export async function removeSeat(id: string, ownerId: string): Promise<SeatRow | null> {
  const rows = await strict<Row[]>(() => table().delete().eq("id", id).eq("owner_id", ownerId).select("*"));
  return rows[0] ? fromRow(rows[0]) : null;
}

/** The invited person accepts their invitation. Returns the seat, or null when there is none waiting. */
export async function acceptSeat(email: string): Promise<SeatRow | null> {
  const rows = await strict<Row[]>(() => table().update({ accepted_at: new Date().toISOString() }).eq("member_email", email.toLowerCase()).is("accepted_at", null).select("*"));
  return rows[0] ? fromRow(rows[0]) : null;
}

/** The invited person refuses their invitation (an accepted seat is left with `leaveSeat`). Returns the invitation removed, or null. */
export async function declineSeat(email: string): Promise<SeatRow | null> {
  const rows = await strict<Row[]>(() => table().delete().eq("member_email", email.toLowerCase()).is("accepted_at", null).select("*"));
  return rows[0] ? fromRow(rows[0]) : null;
}

/** The invited person gives their seat back. Returns the seat left, or null. */
export async function leaveSeat(email: string): Promise<SeatRow | null> {
  const rows = await strict<Row[]>(() => table().delete().eq("member_email", email.toLowerCase()).select("*"));
  return rows[0] ? fromRow(rows[0]) : null;
}
