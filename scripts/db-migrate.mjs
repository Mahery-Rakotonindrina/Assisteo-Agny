// Applies supabase/migrations/*.sql in order, once each, inside a transaction.
// Usage: POSTGRES_URL_NON_POOLING=postgres://… node scripts/db-migrate.mjs
import { applyMigrations, connect } from "./lib/backup.mjs";

const url = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
if (!url) {
  console.error("Set POSTGRES_URL_NON_POOLING (from the Supabase integration on Vercel).");
  process.exit(1);
}

const client = await connect(url);
try {
  await applyMigrations(client, console.log);
  console.log("done");
} catch (error) {
  console.error(`fail  ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
