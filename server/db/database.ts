import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema";

export type AppDatabase = BunSQLiteDatabase<typeof schema>;

export function openDatabase(path: string) {
  const client = new Database(path, { create: true, strict: true });
  client.run("PRAGMA journal_mode=WAL");
  client.run("PRAGMA busy_timeout=5000");
  client.run("PRAGMA foreign_keys=ON");
  const db = drizzle({ client, schema });
  migrate(db, { migrationsFolder: resolve(import.meta.dir, "../../drizzle") });
  return { client, db };
}
