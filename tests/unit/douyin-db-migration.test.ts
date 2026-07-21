import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../server/db/database";

const tempPaths: string[] = [];

afterEach(() => {
  for (const p of tempPaths.splice(0)) {
    try {
      rmSync(p, { force: true });
    } catch {
      /* ok */
    }
    try {
      rmSync(`${p}-wal`, { force: true });
    } catch {
      /* ok */
    }
    try {
      rmSync(`${p}-shm`, { force: true });
    } catch {
      /* ok */
    }
  }
});

function tempDbPath(): string {
  const path = join(tmpdir(), `db-migration-test-${crypto.randomUUID()}.sqlite`);
  tempPaths.push(path);
  return path;
}

describe("database migration", () => {
  test("fresh database has default_asset_folder_id after openDatabase", () => {
    const path = tempDbPath();
    const conn = openDatabase(path);

    const info = conn.client.query("PRAGMA table_info(user_preferences)").all() as Array<{ name: string }>;
    const columns = new Set(info.map((c) => c.name));
    expect(columns.has("default_asset_folder_id")).toBe(true);

    conn.client.close();
  });

  test("old database without default_asset_folder_id gets the column after repair", () => {
    const path = tempDbPath();
    const client = new Database(path, { create: true, strict: true });
    client.run("PRAGMA journal_mode=WAL");
    client.run("PRAGMA foreign_keys=ON");

    // Create minimal old schema WITHOUT default_asset_folder_id
    client.run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL, display_name TEXT NOT NULL,
        avatar_text TEXT NOT NULL, credits INTEGER NOT NULL DEFAULT 2480,
        status TEXT NOT NULL DEFAULT 'active',
        password_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      )
    `);
    client.run(`
      CREATE TABLE IF NOT EXISTS asset_folders (
        id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL REFERENCES users(id),
        parent_id TEXT REFERENCES asset_folders(id), name TEXT NOT NULL,
        storage_prefix TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      )
    `);
    client.run(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id TEXT PRIMARY KEY REFERENCES users(id),
        theme TEXT NOT NULL DEFAULT 'system',
        default_ratio TEXT NOT NULL DEFAULT '9:16',
        language TEXT NOT NULL DEFAULT 'zh-CN',
        task_notifications INTEGER NOT NULL DEFAULT 1,
        autoplay_results INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      )
    `);

    // Insert test data
    const userId = crypto.randomUUID();
    const now = new Date().toISOString();
    client.run(
      "INSERT INTO users (id, email, password_hash, display_name, avatar_text, created_at, updated_at) VALUES (?, 'test@example.com', 'hash', 'Test', 'T', ?, ?)",
      [userId, now, now],
    );
    client.run("INSERT INTO user_preferences (user_id, updated_at) VALUES (?, ?)", [userId, now]);

    // Verify column does NOT exist before repair
    const before = client.query("PRAGMA table_info(user_preferences)").all() as Array<{ name: string }>;
    expect(new Set(before.map((c) => c.name)).has("default_asset_folder_id")).toBe(false);

    client.close();

    // Now open via openDatabase which applies migrations + runtime repair
    const conn = openDatabase(path);

    // Verify column now exists
    const after = conn.client.query("PRAGMA table_info(user_preferences)").all() as Array<{ name: string }>;
    const afterCols = new Set(after.map((c) => c.name));
    expect(afterCols.has("default_asset_folder_id")).toBe(true);

    // Verify existing data is intact
    const row = conn.client
      .query("SELECT user_id, theme, default_ratio FROM user_preferences WHERE user_id = ?")
      .get(userId) as Record<string, unknown>;
    expect(row.user_id).toBe(userId);
    expect(row.theme).toBe("system");
    expect(row.default_ratio).toBe("9:16");

    conn.client.close();
  });
});
