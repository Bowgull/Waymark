CREATE TABLE `user_profile` (
  `id` text PRIMARY KEY DEFAULT 'default' NOT NULL,
  `goals` text,
  `injuries` text,
  `posture_issues` text,
  `training_history` text,
  `mt_gym_access_days` text,
  `mt_cap_per_week` integer,
  `weekly_day_target` integer,
  `constraints` text,
  `onboarded_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE TABLE `body_metrics` (
  `id` text PRIMARY KEY NOT NULL,
  `logged_at` integer NOT NULL,
  `weight_kg` real,
  `resting_hr` integer,
  `bodyfat_pct` real,
  `notes` text,
  `created_at` integer NOT NULL
);

CREATE INDEX `idx_body_metrics_logged` ON `body_metrics` (`logged_at`);

CREATE TABLE `coaching_outputs` (
  `id` text PRIMARY KEY NOT NULL,
  `kind` text NOT NULL,
  `model` text NOT NULL,
  `scope_week_plan_id` text REFERENCES `week_plans`(`id`),
  `scope_session_id` text REFERENCES `sessions`(`id`),
  `input_hash` text,
  `output_json` text NOT NULL,
  `tokens_in` integer,
  `tokens_out` integer,
  `cached_tokens_in` integer,
  `created_at` integer NOT NULL
);

CREATE INDEX `idx_coaching_kind_created` ON `coaching_outputs` (`kind`, `created_at`);
CREATE INDEX `idx_coaching_week` ON `coaching_outputs` (`scope_week_plan_id`);
CREATE INDEX `idx_coaching_session` ON `coaching_outputs` (`scope_session_id`);
