-- One-time baseline: mark migrations 0000-0025 as applied in wrangler's
-- d1_migrations table WITHOUT running them. Production already has every one
-- of them (schema compared against the 2026-10-18 export: all tables, columns,
-- indexes and foreign keys match a fresh build from drizzle/; the migration
-- seed rows are present). After this, `wrangler d1 migrations list` shows only
-- newer files (0026+) as pending and `migrations apply` runs just those.
--
-- Run once per database, before the first `migrations apply`:
--   npx wrangler d1 execute waymark-db --remote --file=./scripts/d1-baseline-migrations.sql
-- Safe to re-run: the table is CREATE IF NOT EXISTS and rows are INSERT OR IGNORE.
--
-- Guards: each SELECT below fails ("no such column/table") if the database is
-- missing the newest object a migration added, so the file stops before
-- marking anything applied on a database that is not actually up to date.

SELECT label FROM sessions LIMIT 0;                       -- 0025
SELECT completed_at FROM strength_sets LIMIT 0;           -- 0024
SELECT planned_weight_kg, band_color FROM strength_sets LIMIT 0; -- 0023
SELECT completion_status FROM run_sessions LIMIT 0;       -- 0023
SELECT context_json FROM sessions LIMIT 0;                -- 0022
SELECT user_message FROM app_logs LIMIT 0;                -- 0021
SELECT dob, max_hr FROM user_profile LIMIT 0;             -- 0013
SELECT skip_reason, skip_reason_detail FROM sessions LIMIT 0; -- 0011
SELECT review, review_flag FROM sessions LIMIT 0;         -- 0011
SELECT am_enabled, pm_enabled FROM settings LIMIT 0;      -- 0011
SELECT block_type FROM training_blocks LIMIT 0;           -- 0008

-- Exactly the DDL wrangler 4.78 runs in initMigrationsTable (verified by
-- `wrangler d1 migrations apply --local` on an empty database).
CREATE TABLE IF NOT EXISTS d1_migrations(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0000_init_sessions.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0001_open_supernaut.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0002_phase5_intelligence.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0003_journal_entries.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0004_phase10_progression.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0005_training_intelligence.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0006_pm_session_time.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0007_combo_form_tips.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0008_block_zero.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0009_combo_additions.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0010_ai_foundation.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0011_notification_toggles.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0011_session_review.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0011_skip_reason.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0012_strava_tokens.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0013_hr_and_strava_link.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0014_combo_library_phase1.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0015_bag_round_structure.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0016_mobility_rename.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0017_app_logs.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0018_codified_profile.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0019_static_stretch_warmup.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0020_manual_apr22_run.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0021_app_logs_user_message.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0022_road_bootcamp.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0023_training_reality.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0024_strength_set_completed_at.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0025_session_label.sql');
