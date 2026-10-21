-- Coach brain P3 (coach-brain.md §5.3-5.5, §13.5 item 2; approved by Josh 2026-10-20):
-- one row per nightly decision. The rules' facts, the options they offered,
-- the rules' own pick, the AI's pick (when it answered), the final pick and
-- which side it came from (agree / ai / rules / fallback / offline / capped),
-- plus the call's tokens and estimated cost (the daily spend cap reads these).
-- verify_errors_json keeps why an AI answer was refused; outcome_json is
-- filled in later (done or not, reps left, next morning) for the builders'
-- replay. Nothing on screen reads this table.
--
-- One decision a night: (day, trigger) is unique, so a retried night never
-- makes a second set of changes. input_hash is the hash of the inputs.
--
-- Additive only: a new table. No existing table or row is touched.
CREATE TABLE IF NOT EXISTS `coach_decisions` (
  `id` text PRIMARY KEY NOT NULL,
  `day` integer NOT NULL,
  `decided_at` integer NOT NULL,
  `trigger` text NOT NULL,
  `input_hash` text NOT NULL,
  `facts_json` text NOT NULL,
  `candidates_json` text NOT NULL,
  `rules_pick_json` text NOT NULL,
  `ai_pick_json` text,
  `final_json` text NOT NULL,
  `source` text NOT NULL,
  `model` text,
  `calls` integer NOT NULL DEFAULT 0,
  `latency_ms` integer,
  `input_tokens` integer,
  `output_tokens` integer,
  `cache_read_tokens` integer,
  `cache_write_tokens` integer,
  `cost_usd` real NOT NULL DEFAULT 0,
  `verify_errors_json` text,
  `outcome_json` text
);
CREATE UNIQUE INDEX IF NOT EXISTS `idx_coach_decisions_day_trigger` ON `coach_decisions` (`day`, `trigger`);
CREATE INDEX IF NOT EXISTS `idx_coach_decisions_decided_at` ON `coach_decisions` (`decided_at`);
