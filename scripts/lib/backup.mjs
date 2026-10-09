// What the backup scripts share: the file format, the tables, the database
// connection, the migrations, and how data goes out of and back into Postgres.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import pg from "pg";

export const MAGIC = Buffer.from("AGNYBK1");

/**
 * The app tables a backup holds, and the key a restore merges each row on.
 * Every table the migrations create must be here: scripts/db-restore-check.mjs
 * fails otherwise, so a new table can't be silently left out of the backups.
 */
export const RESTORE_KEYS = {
  analyses: ["user_id", "id"],
  user_settings: ["user_id"],
  user_ai_keys: ["user_id"],
  push_devices: ["user_id", "device_id"],
  parcels: ["user_id", "id"],
  lists: ["user_id", "id"],
  subscriptions: ["id"],
};

export const TABLES = [...Object.keys(RESTORE_KEYS), "_migrations"];

/** Columns a trigger sets on every write: a restore can't bring them back as they were. */
function setByTrigger(table, column) {
  return column === "server_updated_at" || (table === "subscriptions" && column === "updated_at");
}

/**
 * A Postgres client. Supabase's pooler presents a certificate Node doesn't
 * trust by default; "?sslmode=disable" is for a local, throwaway database.
 */
export async function connect(url) {
  const ssl = !/[?&]sslmode=disable/.test(url);
  const client = new pg.Client({ connectionString: url.replace(/[?&]sslmode=[^&]*/, ""), ssl: ssl ? { rejectUnauthorized: false } : false });
  await client.connect();
  return client;
}

function keyFrom(passphrase, salt) {
  return scryptSync(passphrase, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

/** gzip + AES-256-GCM, with a key derived from the passphrase (scrypt). */
export function encryptBackup(data, passphrase) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(passphrase, salt), iv);
  const encrypted = Buffer.concat([cipher.update(gzipSync(JSON.stringify(data))), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), encrypted]);
}

/** The backup's content, or an error: not a backup, wrong passphrase or damaged file. */
export function decryptBackup(raw, passphrase) {
  if (!raw.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Not an Assisteo Agny backup.");
  let offset = MAGIC.length;
  const take = (length) => raw.subarray(offset, (offset += length));
  const salt = take(16);
  const iv = take(12);
  const tag = take(16);
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  try {
    return JSON.parse(gunzipSync(Buffer.concat([decipher.update(raw.subarray(offset)), decipher.final()])).toString("utf8"));
  } catch {
    throw new Error("Can't decrypt: wrong passphrase or damaged file.");
  }
}

/** Every app table, plus a minimal user list (id, e-mail, dates). */
export async function exportData(client) {
  const data = { version: 1, createdAt: new Date().toISOString(), tables: {} };
  for (const table of TABLES) {
    const exists = await client.query("select to_regclass($1) as name", [`public.${table}`]);
    if (!exists.rows[0].name) continue;
    data.tables[table] = (await client.query(`select * from public.${table}`)).rows;
  }
  // Enough to re-create the accounts with the same ids if the project is lost.
  data.tables["auth.users"] = (await client.query("select id, email, created_at, last_sign_in_at from auth.users")).rows;
  return data;
}

/**
 * Upserts the app tables back, inside the caller's transaction. The accounts
 * must exist (same user ids): the rows reference auth.users.
 */
export async function restoreData(client, data, log = () => {}) {
  for (const [table, conflict] of Object.entries(RESTORE_KEYS)) {
    const rows = data.tables[table] ?? [];
    for (const row of rows) {
      const columns = Object.keys(row);
      const values = columns.map((column) => (row[column] !== null && typeof row[column] === "object" && !(row[column] instanceof Date) ? JSON.stringify(row[column]) : row[column]));
      const updates = columns.filter((column) => !conflict.includes(column)).map((column) => `"${column}" = excluded."${column}"`);
      await client.query(
        `insert into public.${table} (${columns.map((column) => `"${column}"`).join(", ")}) values (${columns.map((_, index) => `$${index + 1}`).join(", ")})
         on conflict (${conflict.join(", ")}) ${updates.length ? `do update set ${updates.join(", ")}` : "do nothing"}`,
        values,
      );
    }
    log(`  restored ${table}: ${rows.length} row(s)`);
  }
}

/** JSON with sorted keys and dates as ISO strings, to compare rows read from different places. */
function canonical(value) {
  const sorted = (item) =>
    Array.isArray(item)
      ? item.map(sorted)
      : item && typeof item === "object"
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .map((key) => [key, sorted(item[key])]),
          )
        : item;
  return JSON.stringify(sorted(JSON.parse(JSON.stringify(value))));
}

/**
 * Checks that the database (`actual`, as exportData reads it) holds every row
 * of the backup (`expected`) unchanged. With `exact`, it must hold nothing
 * else either (a restore into an empty database). Problems only give tables
 * and counts, never the data: CI logs can be public.
 */
export function compareData(expected, actual, { exact = false } = {}) {
  const keys = { ...RESTORE_KEYS, "auth.users": ["id"] };
  const problems = [];
  for (const [table, key] of Object.entries(keys)) {
    const wanted = expected.tables[table] ?? [];
    const found = new Map((actual.tables[table] ?? []).map((row) => [canonical(key.map((column) => row[column])), row]));
    let missing = 0;
    let different = 0;
    for (const row of wanted) {
      const restored = found.get(canonical(key.map((column) => row[column])));
      if (!restored) {
        missing += 1;
        continue;
      }
      const columns = Object.keys(row).filter((column) => !setByTrigger(table, column));
      if (canonical(columns.map((column) => row[column])) !== canonical(columns.map((column) => restored[column]))) different += 1;
    }
    const extra = exact ? found.size - (wanted.length - missing) : 0;
    if (missing) problems.push(`${table}: ${missing} row(s) missing`);
    if (different) problems.push(`${table}: ${different} row(s) different`);
    if (extra > 0) problems.push(`${table}: ${extra} row(s) not in the backup`);
  }
  return problems;
}

/** Applies supabase/migrations/*.sql in order, once each, each in its own transaction. */
export async function applyMigrations(client, log = () => {}) {
  const dir = join(process.cwd(), "supabase", "migrations");
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  await client.query("create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now())");
  const { rows } = await client.query("select name from public._migrations");
  const applied = new Set(rows.map((row) => row.name));

  for (const file of files) {
    if (applied.has(file)) {
      log(`skip  ${file}`);
      continue;
    }
    try {
      await client.query("begin");
      await client.query(readFileSync(join(dir, file), "utf8"));
      await client.query("insert into public._migrations (name) values ($1)", [file]);
      await client.query("commit");
      log(`apply ${file}`);
    } catch (error) {
      await client.query("rollback");
      throw new Error(`${file}: ${error.message}`);
    }
  }
  await client.query("alter table public._migrations enable row level security");
}
