-- Coach brain P1 (coach-brain.md §4, §13.5 item 1; approved by Josh 2026-10-20):
-- the athlete model's estimates. One row per area and key: each main lift
-- (key = exercise id), the run (line, tolerance), the bag, MT classes (main,
-- class nights), recovery, the back and when he trains (slot cells, start
-- times, rest days, schedule skips). value_json holds the estimate; state is
-- GUESS / LEARNING / KNOWN; uncertainty is u in [0, 1].
--
-- The nightly job rebuilds every row from the logged history
-- (server/athleteModel.ts), so the first night is the backfill. Shadow only in
-- P1: nothing reads these rows to decide a session or a dose yet.
--
-- Additive only: a new table. No existing table or row is touched.
CREATE TABLE IF NOT EXISTS `athlete_estimates` (
  `id` text PRIMARY KEY NOT NULL,
  `kind` text NOT NULL,
  `key` text NOT NULL,
  `value_json` text NOT NULL,
  `state` text NOT NULL,
  `n` integer NOT NULL DEFAULT 0,
  `uncertainty` real NOT NULL,
  `model_version` integer NOT NULL DEFAULT 1,
  `as_of_day` integer NOT NULL,
  `updated_at` integer NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS `idx_athlete_estimates_kind_key` ON `athlete_estimates` (`kind`, `key`);
