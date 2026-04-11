CREATE TABLE `active_recovery_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`hip_mobility` integer DEFAULT 0 NOT NULL,
	`foam_rolling` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_recovery_session` ON `active_recovery_sessions` (`session_id`);--> statement-breakpoint
CREATE TABLE `bag_work_round_combos` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`combo_id` text NOT NULL,
	`order_index` integer NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `bag_work_rounds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`combo_id`) REFERENCES `combos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_bwrc_round` ON `bag_work_round_combos` (`round_id`);--> statement-breakpoint
CREATE TABLE `bag_work_rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`round_number` integer NOT NULL,
	`duration_sec` integer DEFAULT 180 NOT NULL,
	`rest_sec` integer DEFAULT 60 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_bwr_session` ON `bag_work_rounds` (`session_id`);--> statement-breakpoint
CREATE TABLE `combos` (
	`id` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`tier` text NOT NULL,
	`level` text NOT NULL,
	`unlocked` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_combos_tier` ON `combos` (`tier`,`level`);--> statement-breakpoint
CREATE TABLE `daily_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`log_date` integer NOT NULL,
	`sleep_hours` real,
	`weed_grams` real,
	`alcohol_scale` integer,
	`soreness` integer,
	`notes` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_logs_log_date_unique` ON `daily_logs` (`log_date`);--> statement-breakpoint
CREATE INDEX `idx_daily_log_date` ON `daily_logs` (`log_date`);--> statement-breakpoint
CREATE TABLE `exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`muscle_groups` text,
	`equipment` text,
	`form_cues` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exercises_name_unique` ON `exercises` (`name`);--> statement-breakpoint
CREATE INDEX `idx_exercises_category` ON `exercises` (`category`);--> statement-breakpoint
CREATE TABLE `mt_class_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`class_type` text,
	`focus_skill` text,
	`weakness` text,
	`concept` text,
	`action_items` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_mt_session` ON `mt_class_logs` (`session_id`);--> statement-breakpoint
CREATE TABLE `posture_session_exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`order_index` integer NOT NULL,
	`hold_sec` integer,
	`sets` integer DEFAULT 1,
	`completed` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_pse_session` ON `posture_session_exercises` (`session_id`);--> statement-breakpoint
CREATE TABLE `run_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`plan_week` integer,
	`run_type` text,
	`distance_km` real,
	`duration_sec` integer,
	`pace_sec_km` integer,
	`is_indoor` integer DEFAULT 0 NOT NULL,
	`one_pace_arc` text,
	`one_pace_ep` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_run_session` ON `run_sessions` (`session_id`);--> statement-breakpoint
CREATE TABLE `running_plan_weeks` (
	`id` text PRIMARY KEY NOT NULL,
	`block_id` text NOT NULL,
	`week_number` integer NOT NULL,
	`day_of_week` integer NOT NULL,
	`run_type` text NOT NULL,
	`target_desc` text,
	`target_dur_sec` integer,
	`target_dist_km` real,
	FOREIGN KEY (`block_id`) REFERENCES `training_blocks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_rpw_block` ON `running_plan_weeks` (`block_id`,`week_number`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY DEFAULT 'default' NOT NULL,
	`mt_class_days` text,
	`am_reminder` text,
	`pm_lead_min` integer,
	`one_pace_arc` text,
	`one_pace_ep` text,
	`last_deploy` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `skip_rope_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`round_count` integer NOT NULL,
	`round_dur_sec` integer DEFAULT 180 NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_skip_session` ON `skip_rope_sessions` (`session_id`);--> statement-breakpoint
CREATE TABLE `strength_session_exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`order_index` integer NOT NULL,
	`notes` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_sse_session` ON `strength_session_exercises` (`session_id`);--> statement-breakpoint
CREATE TABLE `strength_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`session_exercise_id` text NOT NULL,
	`set_number` integer NOT NULL,
	`weight_kg` real,
	`reps` integer NOT NULL,
	`is_warmup` integer DEFAULT 0 NOT NULL,
	`rest_sec` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_exercise_id`) REFERENCES `strength_session_exercises`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_sets_exercise` ON `strength_sets` (`session_exercise_id`);--> statement-breakpoint
CREATE TABLE `training_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`total_weeks` integer NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `training_maxes` (
	`id` text PRIMARY KEY NOT NULL,
	`exercise_id` text NOT NULL,
	`weight_kg` real NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_max_exercise` ON `training_maxes` (`exercise_id`);--> statement-breakpoint
CREATE TABLE `week_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`block_id` text NOT NULL,
	`week_number` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`approved_at` integer,
	`notes` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`block_id`) REFERENCES `training_blocks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_week_plans_block` ON `week_plans` (`block_id`,`week_number`);--> statement-breakpoint
CREATE TABLE `weekly_journals` (
	`id` text PRIMARY KEY NOT NULL,
	`week_start` integer NOT NULL,
	`reflection` text,
	`prompt` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weekly_journals_week_start_unique` ON `weekly_journals` (`week_start`);--> statement-breakpoint
CREATE INDEX `idx_journal_week` ON `weekly_journals` (`week_start`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`week_plan_id` text,
	`scheduled_date` integer,
	`time_slot` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`duration_sec` integer,
	`rpe` integer,
	`difficulty` integer,
	`notes` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`week_plan_id`) REFERENCES `week_plans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_sessions`("id", "type", "week_plan_id", "scheduled_date", "time_slot", "status", "started_at", "completed_at", "duration_sec", "rpe", "difficulty", "notes", "created_at") SELECT "id", "type", "week_plan_id", "scheduled_date", "time_slot", "status", "started_at", "completed_at", "duration_sec", "rpe", "difficulty", "notes", "created_at" FROM `sessions`;--> statement-breakpoint
DROP TABLE `sessions`;--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_sessions_date` ON `sessions` (`scheduled_date`);--> statement-breakpoint
CREATE INDEX `idx_sessions_week` ON `sessions` (`week_plan_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_type` ON `sessions` (`type`);--> statement-breakpoint
CREATE INDEX `idx_sessions_status` ON `sessions` (`status`,`scheduled_date`);