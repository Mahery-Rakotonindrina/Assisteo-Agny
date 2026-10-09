// Opens a backup made by scripts/db-backup.mjs.
// Usage:
//   BACKUP_PASSPHRASE=… node scripts/db-restore.mjs <file.agny>                  → prints what it contains
//   BACKUP_PASSPHRASE=… node scripts/db-restore.mjs <file.agny> --json out.json  → writes the decrypted JSON
//   BACKUP_PASSPHRASE=… POSTGRES_URL_NON_POOLING=… node scripts/db-restore.mjs <file.agny> --apply
//     → upserts the app tables back (the accounts must exist: same user ids).
//   … --apply --dry-run → same, checks the data reads back identical, then rolls back.
import { readFileSync, writeFileSync } from "node:fs";
import { compareData, connect, decryptBackup, exportData, restoreData } from "./lib/backup.mjs";

const [file, ...flags] = process.argv.slice(2);
const passphrase = process.env.BACKUP_PASSPHRASE;
if (!file || !passphrase) {
  console.error("Usage: BACKUP_PASSPHRASE=… node scripts/db-restore.mjs <file.agny> [--json out.json | --apply]");
  process.exit(1);
}

let data;
try {
  data = decryptBackup(readFileSync(file), passphrase);
} catch (error) {
  console.error(error.message);
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
  const client = await connect(url);
  try {
    await client.query("begin");
    await restoreData(client, data, console.log);
    if (flags.includes("--dry-run")) {
      // Compare what the database now holds with the backup, then undo everything.
      const problems = compareData(data, await exportData(client));
      if (problems.length) throw new Error(`The data doesn't read back identical:\n  ${problems.join("\n  ")}`);
      await client.query("rollback");
      console.log("Dry run OK: every row reads back identical. Nothing was changed.");
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
