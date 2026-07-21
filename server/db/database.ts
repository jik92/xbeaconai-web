import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema";

export type AppDatabase = BunSQLiteDatabase<typeof schema>;

function ensureColumn(client: Database, table: string, column: string, definition: string) {
  const columns = client.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) client.run(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

export function openDatabase(path: string) {
  const client = new Database(path, { create: true, strict: true });
  client.run("PRAGMA journal_mode=WAL");
  client.run("PRAGMA busy_timeout=5000");
  client.run("PRAGMA foreign_keys=ON");
  const db = drizzle({ client, schema });
  migrate(db, { migrationsFolder: resolve(import.meta.dir, "../../drizzle") });

  // Forward repair: ensure default_asset_folder_id exists for databases
  // created before this column was added to the initial migration.
  ensureColumn(
    client,
    "user_preferences",
    "default_asset_folder_id",
    "default_asset_folder_id TEXT REFERENCES asset_folders(id)",
  );
  // Legacy databases may have applied an older initial migration before media
  // metadata was introduced. Keep this repair idempotent for every startup.
  ensureColumn(client, "media_assets", "width", "width INTEGER");
  ensureColumn(client, "media_assets", "height", "height INTEGER");
  ensureColumn(client, "media_assets", "duration_sec", "duration_sec REAL");

  return { client, db };
}
