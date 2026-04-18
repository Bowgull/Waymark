-- Demo wipe: clears all user-generated training data.
-- Preserves static library tables: exercises, combos, training_maxes, settings, user_profile, strava_tokens.
-- Run: npm run db:demo:wipe:remote (or :local)

PRAGMA defer_foreign_keys = ON;

-- Child tables first (FK dependencies)
DELETE FROM strength_sets;
DELETE FROM combo_performance;
DELETE FROM bag_work_round_combos;
DELETE FROM bag_work_rounds;
DELETE FROM strength_session_exercises;
DELETE FROM run_splits;
DELETE FROM run_sessions;
DELETE FROM posture_session_exercises;
DELETE FROM skip_rope_sessions;
DELETE FROM active_recovery_sessions;
DELETE FROM mt_class_logs;
DELETE FROM coaching_outputs;
DELETE FROM week_adjustments;
DELETE FROM sessions;
DELETE FROM running_plan_weeks;
DELETE FROM week_plans;
DELETE FROM training_blocks;
DELETE FROM daily_logs;
DELETE FROM weekly_journals;
DELETE FROM journal_entries;
DELETE FROM body_metrics;

-- Reset combo state (keep library rows but clear favourites + mastery)
UPDATE combos SET is_favourite = 0, mastery_score = 0, times_sharp = 0;
