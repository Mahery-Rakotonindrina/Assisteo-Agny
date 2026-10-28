// Tests the Row Level Security of the shared budget (0009_households.sql) on a
// throwaway Postgres: a database of its own is created next to the one given,
// the migrations are applied as on Supabase, the checks run (scripts/lib/rlsChecks.mjs),
// and the database is dropped. Run by CI on every push.
// Usage:
//   CHECK_DATABASE_URL=postgres://…?sslmode=disable node scripts/db-rls-check.mjs
import { applyMigrations, connect } from "./lib/backup.mjs";
import { runRlsChecks } from "./lib/rlsChecks.mjs";
import { SUPABASE_GRANTS, SUPABASE_STUBS } from "./lib/supabaseStubs.mjs";

const url = process.env.CHECK_DATABASE_URL;
if (!url) {
  console.error("Usage: CHECK_DATABASE_URL=postgres://…?sslmode=disable node scripts/db-rls-check.mjs");
  process.exit(1);
}
if (/supabase/i.test(url)) {
  console.error("CHECK_DATABASE_URL must be a throwaway database, not Supabase.");
  process.exit(1);
}

const name = `agny_rls_check_${Date.now()}`;
const admin = await connect(url);
await admin.query(`create database ${name}`);

let problems = [];
const target = new URL(url);
target.pathname = `/${name}`;
const client = await connect(target.toString());
try {
  await client.query(SUPABASE_STUBS);
  await client.query(SUPABASE_GRANTS);
  await applyMigrations(client);
  problems = await runRlsChecks(client);
} catch (error) {
  problems.push(error.message);
} finally {
  await client.end();
  await admin.query(`drop database if exists ${name}`);
  await admin.end();
}

if (problems.length) {
  console.error(`FAIL  Row Level Security of the shared budget:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("OK    Row Level Security of the shared budget: every check passed.");
