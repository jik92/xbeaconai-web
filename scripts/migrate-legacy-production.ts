import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { chmod, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const dataDir = resolve(process.env.YAOZUO_DATA_DIR ?? ".data");
const databasePath = resolve(dataDir, "yaozuo.sqlite");

if (!existsSync(databasePath)) {
  console.log("Legacy database upgrade skipped: database does not exist yet.");
  process.exit(0);
}

const db = new Database(databasePath, { strict: true });
const tableExists = (table: string) =>
  Boolean(db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
const columns = (table: string) =>
  new Set((db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((item) => item.name));

const definitions: Record<string, Record<string, string>> = {
  media_assets: {
    width: "INTEGER",
    height: "INTEGER",
    duration_sec: "REAL",
    asset_kind: "TEXT NOT NULL DEFAULT 'media'",
    display_name: "TEXT NOT NULL DEFAULT ''",
    description: "TEXT",
    product_group_id: "TEXT",
    sort_order: "INTEGER NOT NULL DEFAULT 0",
    sharing_scope: "TEXT NOT NULL DEFAULT 'private'",
    folder_id: "TEXT",
  },
  user_preferences: {
    default_asset_folder_id: "TEXT",
  },
};

const missing = Object.entries(definitions).flatMap(([table, tableDefinitions]) => {
  if (!tableExists(table)) return [];
  const existing = columns(table);
  return Object.keys(tableDefinitions)
    .filter((column) => !existing.has(column))
    .map((column) => ({ table, column, definition: tableDefinitions[column] }));
});

if (!missing.length) {
  console.log("Legacy database upgrade skipped: schema is already compatible.");
  db.close();
  process.exit(0);
}

const backupDir = resolve(dataDir, "backups");
await mkdir(backupDir, { recursive: true, mode: 0o700 });
const backupPath = resolve(
  backupDir,
  `yaozuo-before-legacy-upgrade-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`,
);
const escapedBackupPath = backupPath.replaceAll("'", "''");

db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
db.exec(`VACUUM INTO '${escapedBackupPath}'`);
await chmod(backupPath, 0o600);

db.transaction(() => {
  for (const item of missing) db.exec(`ALTER TABLE ${item.table} ADD COLUMN ${item.column} ${item.definition}`);
})();

const integrity = db.query("PRAGMA integrity_check").get() as { integrity_check: string };
if (integrity.integrity_check !== "ok") throw new Error(`SQLite integrity check failed: ${integrity.integrity_check}`);

console.log(`Legacy database backup: ${backupPath}`);
console.log(`Legacy database columns added: ${missing.map((item) => `${item.table}.${item.column}`).join(", ")}`);
console.log("SQLite integrity check: ok");
db.close();
