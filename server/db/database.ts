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

function repairLegacyUserStatusConstraint(client: Database) {
  const usersTable = client.query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get() as
    | { sql: string | null }
    | undefined;
  const definition = usersTable?.sql?.toUpperCase() ?? "";

  // Early phone-auth databases restricted the status column to active and disabled.
  // A missing CHECK constraint is already compatible, so only rebuild constrained legacy tables.
  if (!definition.includes("CHECK") || definition.includes("PENDING_PASSWORD")) return;

  client.run("PRAGMA foreign_keys=OFF");
  try {
    client.run("BEGIN IMMEDIATE");
    client.run(`CREATE TABLE users__status_repair (
      id TEXT PRIMARY KEY NOT NULL,
      phone TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      avatar_text TEXT NOT NULL,
      credits INTEGER NOT NULL DEFAULT 2480,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('pending_password','active','disabled')),
      password_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    client.run(`INSERT INTO users__status_repair (
      id, phone, password_hash, display_name, avatar_text, credits, status, password_version, created_at, updated_at
    ) SELECT
      id, phone, password_hash, display_name, avatar_text, credits,
      CASE WHEN status IN ('pending_password', 'active', 'disabled') THEN status ELSE 'disabled' END,
      password_version, created_at, updated_at
    FROM users`);
    client.run("DROP TABLE users");
    client.run("ALTER TABLE users__status_repair RENAME TO users");
    client.run("CREATE UNIQUE INDEX users_phone_unique ON users (phone)");
    client.run("CREATE UNIQUE INDEX users_phone_idx ON users (phone)");
    client.run("COMMIT");
  } catch (error) {
    client.run("ROLLBACK");
    throw error;
  } finally {
    client.run("PRAGMA foreign_keys=ON");
  }
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
  repairLegacyUserStatusConstraint(client);

  return { client, db };
}
