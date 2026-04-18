-- Step 3: HR metrics on run_sessions, splits table, user_profile HR context.

ALTER TABLE run_sessions ADD COLUMN avg_hr INTEGER;
ALTER TABLE run_sessions ADD COLUMN max_hr INTEGER;
ALTER TABLE run_sessions ADD COLUMN zone_seconds TEXT;
ALTER TABLE run_sessions ADD COLUMN elevation_gain_m INTEGER;
ALTER TABLE run_sessions ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE run_sessions ADD COLUMN strava_activity_id INTEGER;
ALTER TABLE run_sessions ADD COLUMN attachment_status TEXT;

CREATE UNIQUE INDEX idx_run_strava ON run_sessions(strava_activity_id);

CREATE TABLE run_splits (
  id TEXT PRIMARY KEY,
  run_session_id TEXT NOT NULL REFERENCES run_sessions(id),
  km_index INTEGER NOT NULL,
  duration_sec INTEGER NOT NULL,
  avg_hr INTEGER,
  elevation_gain_m INTEGER
);

CREATE INDEX idx_run_splits_session ON run_splits(run_session_id);

ALTER TABLE user_profile ADD COLUMN max_hr INTEGER;
ALTER TABLE user_profile ADD COLUMN dob TEXT;
