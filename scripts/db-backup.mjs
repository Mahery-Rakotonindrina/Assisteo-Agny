// Encrypted backup of the account data (Supabase Postgres).
// Usage: POSTGRES_URL_NON_POOLING=… BACKUP_PASSPHRASE=… node scripts/db-backup.mjs [outDir]
//
// Exports every app table plus a minimal user list (id, e-mail, dates) as
// JSON, gzips it and encrypts it with AES-256-GCM (key derived from the
// passphrase with scrypt). Photos stay in Supabase Storage and on the phones;
// they are not part of this file. Restore: scripts/db-restore.mjs.
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import pg from "pg";

export const MAGIC = Buffer.from("AGNYBK1");
export const TABLES = ["analyses", "user_settings", "user_ai_keys", "push_devices", "parcels", "_migrations"];

const url = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
const passphrase = process.env.BACKUP_PASSPHRASE;
if (!url || !passphrase) {
  console.error("Set POSTGRES_URL_NON_POOLING and BACKUP_PASSPHRASE.");
  process.exit(1);
}
if (passphrase.length < 16) {
  console.error("BACKUP_PASSPHRASE must be at least 16 characters.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url.replace(/[?&]sslmode=[^&]*/, ""), ssl: { rejectUnauthorized: false } });
await client.connect();
const data = { version: 1, createdAt: new Date().toISOString(), tables: {} };
try {
  for (const table of TABLES) {
    const exists = await client.query("select to_regclass($1) as name", [`public.${table}`]);
    if (!exists.rows[0].name) continue;
    data.tables[table] = (await client.query(`select * from public.${table}`)).rows;
  }
  // Enough to re-create the accounts with the same ids if the project is lost.
  data.tables["auth.users"] = (await client.query("select id, email, created_at, last_sign_in_at from auth.users")).rows;
} finally {
  await client.end();
}

const salt = randomBytes(16);
const iv = randomBytes(12);
const key = scryptSync(passphrase, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const cipher = createCipheriv("aes-256-gcm", key, iv);
const encrypted = Buffer.concat([cipher.update(gzipSync(JSON.stringify(data))), cipher.final()]);
const file = Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), encrypted]);

const outDir = process.argv[2] ?? "backups";
mkdirSync(outDir, { recursive: true });
const path = join(outDir, `assisteo-backup-${data.createdAt.slice(0, 10)}.agny`);
writeFileSync(path, file);
const counts = Object.entries(data.tables)
  .map(([table, rows]) => `${table}: ${rows.length}`)
  .join(", ");
console.log(`Backup written to ${path} (${Math.round(file.length / 1024)} KB) — ${counts}`);
