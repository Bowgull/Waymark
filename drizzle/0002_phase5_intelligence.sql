-- Phase 5: Add form_video_url to exercises, block_week to sessions, section to strength_session_exercises
ALTER TABLE `exercises` ADD COLUMN `form_video_url` text;
--> statement-breakpoint
ALTER TABLE `sessions` ADD COLUMN `block_week` integer;
--> statement-breakpoint
ALTER TABLE `strength_session_exercises` ADD COLUMN `section` text;
