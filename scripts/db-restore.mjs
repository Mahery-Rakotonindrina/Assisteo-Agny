// Opens a backup made by scripts/db-backup.mjs.
// Usage:
//   BACKUP_PASSPHRASE=… node scripts/db-restore.mjs <file.agny>                  → prints what it contains
//   BACKUP_PASSPHRASE=… node scripts/db-restore.mjs <file.agny> --json out.json  → writes the decrypted JSON
//   BACKUP_PASSPHRASE=… POSTGRES_URL_NON_POOLING=… node scripts/db-restore.mjs <file.agny> --apply
//     → upserts the app tables back (the accounts must exist: same user ids).
//   … --apply --dry-run → same, checks the data reads back identical, then rolls back.
import { createDecipheriv, scryptSync } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import pg from "pg";

const MAGIC = Buffer.from("AGNYBK1");
const [file, ...flags] = process.argv.slice(2);
const passphrase = process.env.BACKUP_PASSPHRASE;
if (!file || !passphrase) {
  console.error("Usage: BACKUP_PASSPHRASE=… node scripts/db-restore.mjs <file.agny> [--json out.json | --apply]");
  process.exit(1);
}

const raw = readFileSync(file);
if (!raw.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Not an Assisteo Agny backup.");
let offset = MAGIC.length;
const take = (length) => raw.subarray(offset, (offset += length));
const salt = take(16);
const iv = take(12);
const tag = take(16);
const key = scryptSync(passphrase, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const decipher = createDecipheriv("aes-256-gcm", key, iv);
decipher.setAuthTag(tag);
let data;
try {
  data = JSON.parse(gunzipSync(Buffer.concat([decipher.update(raw.subarray(offset)), decipher.final()])).toString("utf8"));
} catch {
  console.error("Can't decrypt: wrong passphrase or damaged file.");
  process.exit(1);
}

console.log(`Backup from ${data.createdAt}`);
for (const [table, rows] of Object.entries(data.tables)) console.log(`  ${table}: ${rows.length} row(s)`);

const jsonIndex = flags.indexOf("--json");
if (jsonIndex >= 0) {
  writeFileSync(flags[jsonIndex + 1] ?? "backup.json", JSON.stringify(data, null, 2));
  console.log("Decrypted JSON written. It contains personal data: delete it when done.");
}

if (flags.includes("--apply")) {
  const url = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
  if (!url) throw new Error("Set POSTGRES_URL_NON_POOLING to apply.");
  const keys = { analyses: ["user_id", "id"], user_settings: ["user_id"], user_ai_keys: ["user_id"], push_devices: ["user_id", "device_id"] };
  const client = new pg.Client({ connectionString: url.replace(/[?&]sslmode=[^&]*/, ""), ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("begin");
    for (const [table, conflict] of Object.entries(keys)) {
      for (const row of data.tables[table] ?? []) {
        const columns = Object.keys(row);
        const values = columns.map((column) => (row[column] !== null && typeof row[column] === "object" && !(row[column] instanceof Date) ? JSON.stringify(row[column]) : row[column]));
        const updates = columns.filter((column) => !conflict.includes(column)).map((column) => `"${column}" = excluded."${column}"`);
        await client.query(
          `insert into public.${table} (${columns.map((column) => `"${column}"`).join(", ")}) values (${columns.map((_, index) => `$${index + 1}`).join(", ")})
           on conflict (${conflict.join(", ")}) do update set ${updates.join(", ")}`,
          values,
        );
      }
      console.log(`  restored ${table}`);
    }
    if (flags.includes("--dry-run")) {
      // Compare what the database now holds with the backup, then undo everything.
      for (const row of data.tables.analyses ?? []) {
        const { rows } = await client.query("select analysis, chat from public.analyses where user_id = $1 and id = $2", [row.user_id, row.id]);
        if (JSON.stringify(rows[0]?.analysis) !== JSON.stringify(row.analysis) || JSON.stringify(rows[0]?.chat) !== JSON.stringify(row.chat)) {
          throw new Error(`Mismatch on analyses ${row.id}`);
        }
      }
      await client.query("rollback");
      console.log("Dry run OK: every analysis reads back identical. Nothing was changed.");
    } else {
      await client.query("commit");
    }
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}
