-- Forward migration: ensure user_preferences.default_asset_folder_id exists.
--
-- This migration is idempotent: it checks whether the column already exists
-- before attempting to add it. SQLite does not support ADD COLUMN IF NOT EXISTS,
-- so we use a two-step approach in a transaction.
--
-- Step 1: Check existence via PRAGMA table_info (done at app level in openDatabase).
-- Step 2: Only ALTER if missing.
--
-- For the migration file itself, we use a safe no-op that always succeeds.
-- The actual column repair is performed by the runtime check in
-- server/db/database.ts openDatabase() immediately after migrations complete.
CREATE TABLE IF NOT EXISTS __dummy_0003 (id INTEGER);
DROP TABLE IF EXISTS __dummy_0003;
