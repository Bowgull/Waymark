-- Coach brain P2 (coach-brain.md §13.5 items 3 and 6; approved by Josh 2026-10-20):
-- the rules-only brain's dose on each session, and the phone's time zone.
--
-- sessions.dose_json: the dose the brain decided (sets x reps @ weight, run
--   pieces and rounds, bag rounds, its level and readiness), written by the
--   nightly pass and the morning check-in's cap and read by every start route.
-- settings.time_zone: the IANA zone the phone sends (X-Waymark-TZ), for local
--   start times and the nightly day. Replaces the America/Toronto constant.
--
-- Additive only: two nullable columns. No existing row is changed.
ALTER TABLE `sessions` ADD `dose_json` text;
--> statement-breakpoint
ALTER TABLE `settings` ADD `time_zone` text;
