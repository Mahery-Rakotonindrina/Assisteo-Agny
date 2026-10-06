// Applies supabase/migrations/*.sql in order, once each, inside a transaction.
// Usage: POSTGRES_URL_NON_POOLING=postgres://… node scripts/db-migrate.mjs
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const url = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
if (!url) {
  console.error("Set POSTGRES_URL_NON_POOLING (from the Supabase integration on Vercel).");
  process.exit(1);
}

const dir = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(dir).filter((file) => file.endsWith(".sql")).sort();

// Supabase's pooler presents a certificate Node doesn't trust by default.
const client = new pg.Client({ connectionString: url.replace(/[?&]sslmode=[^&]*/, ""), ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query("create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now())");
const { rows } = await client.query("select name from public._migrations");
const applied = new Set(rows.map((row) => row.name));

for (const file of files) {
  if (applied.has(file)) {
    console.log(`skip  ${file}`);
    continue;
  }
  try {
    await client.query("begin");
    await client.query(readFileSync(join(dir, file), "utf8"));
    await client.query("insert into public._migrations (name) values ($1)", [file]);
    await client.query("commit");
    console.log(`apply ${file}`);
  } catch (error) {
    await client.query("rollback");
    console.error(`fail  ${file}: ${error.message}`);
    await client.end();
    process.exit(1);
  }
}

await client.query("alter table public._migrations enable row level security");
await client.end();
console.log("done");
