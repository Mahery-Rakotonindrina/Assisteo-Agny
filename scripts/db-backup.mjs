// Encrypted backup of the account data (Supabase Postgres).
// Usage: POSTGRES_URL_NON_POOLING=… BACKUP_PASSPHRASE=… node scripts/db-backup.mjs [outDir]
//
// Exports every app table plus a minimal user list (id, e-mail, dates) as
// JSON, gzips it and encrypts it with AES-256-GCM (key derived from the
// passphrase with scrypt). Photos stay in Supabase Storage and on the phones;
// they are not part of this file. Restore: scripts/db-restore.mjs; automatic
// restore test: scripts/db-restore-check.mjs.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect, encryptBackup, exportData } from "./lib/backup.mjs";

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

const client = await connect(url);
let data;
try {
  data = await exportData(client);
} finally {
  await client.end();
}

const file = encryptBackup(data, passphrase);
const outDir = process.argv[2] ?? "backups";
mkdirSync(outDir, { recursive: true });
const path = join(outDir, `assisteo-backup-${data.createdAt.slice(0, 10)}.agny`);
writeFileSync(path, file);
const counts = Object.entries(data.tables)
  .map(([table, rows]) => `${table}: ${rows.length}`)
  .join(", ");
console.log(`Backup written to ${path} (${Math.round(file.length / 1024)} KB) — ${counts}`);
