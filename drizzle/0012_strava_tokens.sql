CREATE TABLE strava_tokens (
  id TEXT PRIMARY KEY DEFAULT 'default',
  athlete_id INTEGER NOT NULL,
  athlete_name TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  scope TEXT NOT NULL,
  connected_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
