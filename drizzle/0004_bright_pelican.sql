-- Forward migration marker for legacy media_assets metadata columns.
-- SQLite has no conditional ADD COLUMN syntax. openDatabase() performs the
-- idempotent PRAGMA + ALTER repair after Drizzle applies this migration.
CREATE TABLE IF NOT EXISTS __dummy_0004 (id INTEGER);
DROP TABLE IF EXISTS __dummy_0004;
