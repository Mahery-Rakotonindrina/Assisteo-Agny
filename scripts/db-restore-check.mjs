// Proves a backup can really be restored. Into an empty, throwaway Postgres
// (never the real database), it re-creates the schema from the migrations,
// restores the backup and checks that every row reads back identical.
// Usage:
//   CHECK_DATABASE_URL=postgres://…?sslmode=disable BACKUP_PASSPHRASE=… node scripts/db-restore-check.mjs <file.agny>
//   CHECK_DATABASE_URL=postgres://…?sslmode=disable node scripts/db-restore-check.mjs --sample
//     → the same with made-up data in every table (run by CI on every push).
// Only table names and counts are printed: the logs of a public repository
// are public, and a real backup holds personal data.
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { applyMigrations, compareData, connect, decryptBackup, encryptBackup, exportData, RESTORE_KEYS, restoreData } from "./lib/backup.mjs";

const [file] = process.argv.slice(2);
const url = process.env.CHECK_DATABASE_URL;
if (!url || !file) {
  console.error("Usage: CHECK_DATABASE_URL=postgres://… [BACKUP_PASSPHRASE=…] node scripts/db-restore-check.mjs <file.agny | --sample>");
  process.exit(1);
}
if (/supabase/i.test(url)) {
  console.error("CHECK_DATABASE_URL must be a throwaway database, not Supabase.");
  process.exit(1);
}

// What Supabase provides and the migrations rely on, reduced to the minimum.
const SUPABASE_STUBS = `
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text, created_at timestamptz, last_sign_in_at timestamptz);
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
do $$ begin
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text not null, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
`;

/** Made-up rows in every backed-up table: nested JSON, nulls, accents, a tombstone. */
function sampleBackup() {
  const [anna, ben] = [randomUUID(), randomUUID()];
  const at = (day) => new Date(Date.UTC(2026, 9, day, 8, 30, 15, 250)).toISOString();
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    tables: {
      "auth.users": [
        { id: anna, email: "anna@example.com", created_at: at(1), last_sign_in_at: at(8) },
        { id: ben, email: "ben@example.com", created_at: at(2), last_sign_in_at: null },
      ],
      analyses: [
        {
          user_id: anna,
          id: "scan-1",
          created_at: at(3),
          updated_at: at(4),
          deleted_at: null,
          mode: "auto",
          analysis: { category: "food", title: "Œufs à la crème", nutrition: { calories: 320, items: [{ name: "œuf", quantity: 2 }] } },
          meta: { model: "sample", demo: true },
          reminder_at: at(9),
          preview_path: `${anna}/scan-1.jpg`,
          thumbnail_path: null,
          chat: [{ role: "user", content: "C'est sain ?", at: 1759900000000 }],
          reminder_pushed_at: null,
        },
        { user_id: ben, id: "scan-2", created_at: at(5), updated_at: at(6), deleted_at: at(7), mode: "document", analysis: { category: "document" }, meta: {}, reminder_at: null, preview_path: null, thumbnail_path: null, chat: [], reminder_pushed_at: null },
      ],
      user_settings: [{ user_id: anna, data: { locale: "fr", theme: "dark", haptics: true }, updated_at: at(4) }],
      user_ai_keys: [{ user_id: anna, preset_id: "gemini", ciphertext: "v1.sample.sample.sample", updated_at: at(4) }],
      push_devices: [{ user_id: anna, device_id: "install-1", token: "fcm-token", platform: "android", scheduled: ["scan-1"], updated_at: at(4) }],
      parcels: [
        { user_id: anna, id: "parcel-1", data: { label: "Chaussures", status: "transit", costs: { goodsMga: 120000 } }, updated_at: at(5), deleted_at: null },
        { user_id: ben, id: "parcel-2", data: { label: "Sac" }, updated_at: at(6), deleted_at: at(7) },
      ],
      lists: [{ user_id: ben, id: "list-1", data: { title: "Courses", kind: "shopping", items: [{ text: "Riz", quantity: "2 kg", done: false }] }, updated_at: at(6), deleted_at: null }],
      subscriptions: [
        { id: randomUUID(), email: "anna@example.com", plan: "premium", starts_at: at(1), ends_at: at(31), amount_mga: 15000, payment_method: "mvola", payment_ref: "REF-1", note: "Payé en avance", created_at: at(1), updated_at: at(1) },
        { id: randomUUID(), email: "carla@example.com", plan: "unlimited", starts_at: at(2), ends_at: null, amount_mga: null, payment_method: null, payment_ref: null, note: null, created_at: at(2), updated_at: at(2) },
      ],
      _migrations: [],
    },
  };
}

const problems = [];
let data;
if (file === "--sample") {
  data = sampleBackup();
  for (const table of Object.keys(RESTORE_KEYS)) {
    if (!data.tables[table]?.length) problems.push(`${table}: no sample rows (add some in scripts/db-restore-check.mjs)`);
  }
  // Through the real file format, like a downloaded backup.
  const passphrase = randomBytes(24).toString("base64url");
  data = decryptBackup(encryptBackup(data, passphrase), passphrase);
} else {
  if (!process.env.BACKUP_PASSPHRASE) {
    console.error("Set BACKUP_PASSPHRASE.");
    process.exit(1);
  }
  try {
    data = decryptBackup(readFileSync(file), process.env.BACKUP_PASSPHRASE);
  } catch (error) {
    console.error(`FAIL  ${error.message}`);
    process.exit(1);
  }
}
console.log(`Backup from ${data.createdAt}: ${Object.entries(data.tables).map(([table, rows]) => `${table} ${rows.length}`).join(", ")}`);

const client = await connect(url);
try {
  const { rows: guard } = await client.query(
    `select exists (select from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'encrypted_password') as supabase,
            exists (select from information_schema.tables where table_schema = 'public' and table_name = 'analyses') as used`,
  );
  if (guard[0].supabase || guard[0].used) throw new Error("CHECK_DATABASE_URL must point to an empty, throwaway database.");

  await client.query(SUPABASE_STUBS);
  await applyMigrations(client);

  // Every table the migrations create must be in the backups.
  const { rows: tables } = await client.query("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'");
  for (const { table_name: table } of tables) {
    if (table !== "_migrations" && !(table in RESTORE_KEYS)) problems.push(`${table}: created by the migrations but not backed up (scripts/lib/backup.mjs)`);
  }
  // A backup made with a newer schema than this code can't be restored as it is.
  const known = new Set((await client.query("select name from public._migrations")).rows.map((row) => row.name));
  const unknown = (data.tables._migrations ?? []).filter((row) => !known.has(row.name));
  if (unknown.length) problems.push(`_migrations: ${unknown.length} migration(s) of the backup are not in this code`);

  await client.query("begin");
  for (const user of data.tables["auth.users"] ?? []) {
    await client.query("insert into auth.users (id, email, created_at, last_sign_in_at) values ($1, $2, $3, $4)", [user.id, user.email, user.created_at, user.last_sign_in_at]);
  }
  await restoreData(client, data);
  await client.query("commit");

  problems.push(...compareData(data, await exportData(client), { exact: true }));
} catch (error) {
  problems.push(error.message);
} finally {
  await client.end();
}

if (problems.length) {
  console.error(`FAIL  The backup can't be restored as it is:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`OK    Restored into an empty database: ${Object.keys(RESTORE_KEYS).length} tables, every row reads back identical.`);
