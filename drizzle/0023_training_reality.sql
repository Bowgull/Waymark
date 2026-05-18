ALTER TABLE run_sessions ADD COLUMN planned_duration_sec INTEGER;
ALTER TABLE run_sessions ADD COLUMN completion_ratio REAL;
ALTER TABLE run_sessions ADD COLUMN completion_status TEXT;
ALTER TABLE run_sessions ADD COLUMN short_reason TEXT;

ALTER TABLE strength_sets ADD COLUMN planned_weight_kg REAL;
ALTER TABLE strength_sets ADD COLUMN planned_reps INTEGER;
ALTER TABLE strength_sets ADD COLUMN inferred_status TEXT;
ALTER TABLE strength_sets ADD COLUMN load_feedback TEXT;
ALTER TABLE strength_sets ADD COLUMN band_color TEXT;
