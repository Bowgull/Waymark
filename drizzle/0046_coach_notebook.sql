-- The coach's notebook (approved by Josh 2026-10-21, item 1;
-- coach-memory-research-2026-10-21.md §c): a small, capped set of one-line
-- lessons the nightly coach proposes and code checks. Each lesson is tied to
-- the raw evidence behind it (sessions, sets, check-ins, his notes) by
-- coach_lesson_evidence rows; status, dates, counts and source on
-- coach_lessons are worked out again from those links every night, never
-- edited from their own prior values. The claim text is never edited.
-- Nothing on screen reads these tables. It starts empty.
--
-- coach_decisions.notebook_json keeps what the night's AI proposed for the
-- notebook and what code accepted or refused (and why), for the builders.
--
-- Additive only: two new tables and one new nullable column. No existing row
-- is touched.
CREATE TABLE IF NOT EXISTS `coach_lessons` (
  `id` text PRIMARY KEY NOT NULL,
  `kind` text NOT NULL,
  `claim` text NOT NULL,
  `source` text NOT NULL,
  `status` text NOT NULL,
  `first_seen_day` integer,
  `last_confirmed_day` integer,
  `support_count` integer NOT NULL DEFAULT 0,
  `counter_count` integer NOT NULL DEFAULT 0,
  `created_day` integer NOT NULL,
  `created_decision_id` text,
  `retired_day` integer,
  `retired_reason` text,
  `updated_at` integer NOT NULL
);
CREATE INDEX IF NOT EXISTS `idx_coach_lessons_status` ON `coach_lessons` (`status`);
CREATE TABLE IF NOT EXISTS `coach_lesson_evidence` (
  `id` text PRIMARY KEY NOT NULL,
  `lesson_id` text NOT NULL REFERENCES `coach_lessons`(`id`),
  `evidence_id` text NOT NULL,
  `role` text NOT NULL,
  `day` integer NOT NULL,
  `added_day` integer NOT NULL,
  `decision_id` text
);
CREATE UNIQUE INDEX IF NOT EXISTS `idx_coach_lesson_evidence` ON `coach_lesson_evidence` (`lesson_id`, `evidence_id`);
ALTER TABLE `coach_decisions` ADD COLUMN `notebook_json` text;
