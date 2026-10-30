import { reportError } from "./reportError";

// Migration 0011 (a subscription's own features and limits, the features
// offered for a while) may not be applied yet: the code then works as before
// it, and says so once per server instance rather than at every request.

/** A setting that needs a migration the database doesn't have yet. */
export class MigrationNeededError extends Error {
  constructor(public readonly migration: string) {
    super(`Migration ${migration} is not applied.`);
    this.name = "MigrationNeededError";
  }
}

/**
 * A missing column or table, as Postgres ("42703", "42P01") or PostgREST
 * ("PGRST204", "PGRST205": not in its schema cache) reports it.
 */
export function isSchemaMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code === "string" && ["42703", "42P01", "PGRST204", "PGRST205"].includes(code)) return true;
  return typeof message === "string" && /does not exist|schema cache/i.test(message);
}

/** How long a missing piece is taken as missing before trying again (the owner may apply the migration meanwhile). */
const RETRY_MS = 10 * 60 * 1000;
const missingSince = new Map<string, number>();
const reported = new Set<string>();

/** Whether `kind` was found missing a short while ago: skip it without asking the database. */
export function knownMissing(kind: string, now = Date.now()) {
  const since = missingSince.get(kind);
  return since !== undefined && now - since < RETRY_MS;
}

/** Notes `kind` as missing; reported once per instance (tagged with migration 0011 unless `tags` say otherwise). */
export async function noteMissing(kind: string, error: unknown, now = Date.now(), tags?: Record<string, string>) {
  missingSince.set(kind, now);
  if (reported.has(kind)) return;
  reported.add(kind);
  await reportError(error, tags ?? { route: "plan", kind: `migration_0011_${kind}` });
}

/** Found again (the migration was applied): asked normally from now on. */
export function noteFound(kind: string) {
  missingSince.delete(kind);
}

/** For the tests. */
export function resetMissing() {
  missingSince.clear();
  reported.clear();
}
