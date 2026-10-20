-- Class to combo (page 49 sections 1-3, approved 2026-10-19). After an MT
-- class he writes what he learned in one box; the coach pulls out every combo
-- and checks it against the bag. ADD TO BAG puts a new combo in the library
-- (or unlocks a locked one) marked as from class, with the class's day; the
-- glove shows on it wherever it appears. NOT NOW is remembered so the same
-- combo isn't offered again. The note stays with the class log.
--
-- Additive only: four new nullable columns, one new table. No drops, no
-- rewrites, no backfill.

-- 'class' when the combo came from (or was unlocked from) a class; NULL = the library's own.
ALTER TABLE combos ADD COLUMN source TEXT;
-- Local epoch day of that class.
ALTER TABLE combos ADD COLUMN class_date INTEGER;

-- "What you learned": the note as written (the coach reads it) and when (unix seconds).
ALTER TABLE mt_class_logs ADD COLUMN learned_note TEXT;
ALTER TABLE mt_class_logs ADD COLUMN learned_at INTEGER;

-- NOT NOW: one row per combo he passed on, keyed by its strikes (lib/classCombos.ts matchKey).
CREATE TABLE IF NOT EXISTS combo_declines (
  id TEXT PRIMARY KEY,
  strikes_key TEXT NOT NULL,
  -- The strikes as the found line showed them, JSON array.
  strikes_json TEXT NOT NULL,
  -- The class it came from (no foreign key: a fresh start keeps the record).
  session_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_combo_declines_key ON combo_declines (strikes_key);
