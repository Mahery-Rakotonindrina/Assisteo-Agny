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
import { SUPABASE_STUBS } from "./lib/supabaseStubs.mjs";

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


/** Made-up rows in every backed-up table: nested JSON, nulls, accents, a tombstone. */
function sampleBackup() {
  const [anna, ben] = [randomUUID(), randomUUID()];
  const household = randomUUID();
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
      vehicles: [
        {
          user_id: anna,
          id: "vehicle-1",
          data: { name: "La Corolla", kind: "car", plate: "1234 TBA", noticeDays: 5, fuel: [{ id: "f1", at: 1759900000000, km: 45000, litres: 40, full: true, amountMga: 200000 }], maintenance: [], expenses: [], odometer: [] },
          updated_at: at(6),
          deleted_at: null,
        },
        { user_id: ben, id: "vehicle-2", data: { name: "Moto" }, updated_at: at(6), deleted_at: at(7) },
      ],
      expenses: [
        {
          user_id: anna,
          id: "expense-1",
          data: { kind: "expense", at: 1759900000000, amountMga: 12000, category: "market", payment: "cash", note: "Tsena", createdAt: 1759900000000 },
          updated_at: at(6),
          deleted_at: null,
        },
        {
          user_id: anna,
          id: "budget",
          data: { kind: "budget", total: 800000, categories: { market: 250000 }, createdAt: 1759900000000 },
          updated_at: at(6),
          deleted_at: null,
        },
        { user_id: ben, id: "expense-2", data: { kind: "expense", at: 1759900000000, amountMga: 5000, category: "transport" }, updated_at: at(6), deleted_at: at(7) },
      ],
      loans: [
        {
          user_id: anna,
          id: "loan-1",
          data: { direction: "lent", person: "Rakoto", phone: "034 12 345 67", amountMga: 200000, at: 1759900000000, dueAt: 1760500000000, note: "Pour l'écolage", repayments: [{ id: "r1", at: 1760000000000, amountMga: 50000 }] },
          updated_at: at(6),
          deleted_at: null,
        },
        { user_id: ben, id: "loan-2", data: { direction: "borrowed", person: "Tante Lalao", amountMga: 30000, at: 1759900000000, repayments: [] }, updated_at: at(6), deleted_at: at(7) },
      ],
      plants: [
        {
          user_id: anna,
          id: "plant-1",
          data: { name: "Monstera du salon", species: "Monstera deliciosa", place: "indoor", waterEveryDays: 7, lastWateredAt: 1759900000000, scanIds: ["scan-1"], checks: [{ id: "c1", at: 1760000000000, isPlant: true, healthy: false, problem: "Trop d'eau", cause: "Terre humide", treatment: ["Laisser sécher"], urgency: "medium", note: null }] },
          updated_at: at(6),
          deleted_at: null,
        },
        { user_id: ben, id: "plant-2", data: { name: "Basilic", place: "outdoor", waterEveryDays: 2, scanIds: [], checks: [] }, updated_at: at(6), deleted_at: at(7) },
      ],
      loan_shares: [
        {
          token_hash: "a".repeat(64),
          user_id: anna,
          person: "rakoto",
          snapshot: { v: 1, lender: "Anna", borrower: "Rakoto", updatedAt: 1760000000000, loans: [{ amountMga: 200000, interestMga: 0, at: 1759900000000, dueAt: 1760500000000, repayments: [{ at: 1760000000000, amountMga: 50000 }] }] },
          created_at: at(6),
          updated_at: at(6),
          revoked_at: null,
        },
        { token_hash: "b".repeat(64), user_id: anna, person: "rakoto", snapshot: { v: 1 }, created_at: at(5), updated_at: at(5), revoked_at: at(6) },
      ],
      households: [{ id: household, owner_id: anna, data: { name: "Famille Rabe", budget: { total: 900000, categories: { market: 300000 } } }, updated_at: at(5) }],
      household_members: [
        { household_id: household, user_id: anna, role: "owner", joined_at: at(5) },
        { household_id: household, user_id: ben, role: "member", joined_at: at(6) },
      ],
      household_invites: [
        { code: "4K7P2Q", household_id: household, created_by: anna, created_at: at(5), expires_at: at(7), revoked_at: at(6) },
        { code: "HX3M9R", household_id: household, created_by: anna, created_at: at(6), expires_at: at(8), revoked_at: null },
      ],
      household_expenses: [
        { household_id: household, id: "shared-1", user_id: ben, data: { kind: "expense", at: 1759900000000, amountMga: 45000, category: "jirama", note: "Facture d'octobre" }, updated_at: at(6), deleted_at: null },
        { household_id: household, id: "shared-2", user_id: anna, data: { kind: "expense", at: 1759900000000, amountMga: 8000, category: "market" }, updated_at: at(6), deleted_at: at(7) },
      ],
      household_loans: [
        { household_id: household, id: "hloan-1", user_id: anna, data: { kind: "loan", direction: "lent", person: "Voisin Be", amountMga: 60000, at: 1759900000000, createdAt: 1759900000000 }, updated_at: at(6), deleted_at: null },
        { household_id: household, id: "hrep-1", user_id: ben, data: { kind: "repayment", loanId: "hloan-1", at: 1760000000000, amountMga: 20000, authorName: "Ben" }, updated_at: at(6), deleted_at: null },
        // Noted by an account deleted since: kept, without its author.
        { household_id: household, id: "hrep-2", user_id: null, data: { kind: "repayment", loanId: "hloan-1", at: 1760100000000, amountMga: 5000, authorName: "Rasoa" }, updated_at: at(7), deleted_at: null },
      ],
      subscriptions: [
        { id: randomUUID(), email: "anna@example.com", plan: "premium", starts_at: at(1), ends_at: at(31), amount_mga: 15000, payment_method: "mvola", payment_ref: "REF-1", note: "Payé en avance", created_at: at(1), updated_at: at(1), features: { add: ["reseller", "parcelCosts"], remove: ["multiPage"] }, quotas: { scans: 500, deepPerMonth: 10 } },
        // A plan created from the Admin (migration 0015).
        { id: randomUUID(), email: "ben@example.com", plan: "famille", starts_at: at(3), ends_at: at(33), amount_mga: 8000, payment_method: "orange", payment_ref: null, note: null, created_at: at(3), updated_at: at(3), features: null, quotas: null },
        { id: randomUUID(), email: "carla@example.com", plan: "unlimited", starts_at: at(2), ends_at: null, amount_mga: null, payment_method: null, payment_ref: null, note: null, created_at: at(2), updated_at: at(2), features: null, quotas: null },
      ],
      feature_grants: [
        { id: randomUUID(), email: "ben@example.com", feature: "garage", starts_at: at(3), ends_at: at(10), note: "Essai du garage", created_by: "owner", created_at: at(3) },
        { id: randomUUID(), email: "anna@example.com", feature: "pdfExport", starts_at: at(1), ends_at: at(2), note: null, created_by: "admin@example.com", created_at: at(1) },
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
