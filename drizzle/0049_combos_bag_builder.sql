-- His combos and his bag sessions (page 80, approved by Josh 2026-10-23).
--
-- combos.difficulty_override: his own grade after a nudge (▲ ▼), 'easy',
-- 'medium', 'hard' or 'expert'. NULL: the grade comes from the combo's tier
-- (FUNDAMENTALS easy, WEAPONS medium, FLOW and DECEPTION hard, MASTERY expert).
-- A combo he types gets combos.source = 'mine' (no new column: source is text;
-- class combos keep 'class' and class_date).
--
-- bag_routines: a Hybrid or Custom bag session saved with his name. rounds_json
-- is one entry per round, each its combo ids in order (empty: the coach fills
-- it in Hybrid, nothing in Custom). round_sec and rest_sec in seconds.
--
-- A planned bag session's choice (COACH / HYBRID / CUSTOM, the rounds he
-- picked, the length and rest) lives in sessions.context_json under "bag".
--
-- Additive only: one nullable column and one new table. No existing row is changed.
ALTER TABLE `combos` ADD `difficulty_override` text;
CREATE TABLE IF NOT EXISTS `bag_routines` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`mode` text NOT NULL,
	`rounds_json` text NOT NULL,
	`round_sec` integer NOT NULL DEFAULT 180,
	`rest_sec` integer NOT NULL DEFAULT 60,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
CREATE INDEX IF NOT EXISTS `idx_bag_routines_updated` ON `bag_routines` (`updated_at`);
