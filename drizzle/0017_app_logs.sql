-- In-app diagnostic logs. Used by the long-press-logo logs viewer.
-- Stores client-side events (errors, api calls, nav, session lifecycle).
-- Auto-pruned server-side to the last 7 days or 5000 rows.

CREATE TABLE IF NOT EXISTS app_logs (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  level TEXT NOT NULL,
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  context_json TEXT,
  screen TEXT,
  session_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_app_logs_ts ON app_logs (ts DESC);
CREATE INDEX IF NOT EXISTS idx_app_logs_level_ts ON app_logs (level, ts DESC);
CREATE INDEX IF NOT EXISTS idx_app_logs_session ON app_logs (session_id, ts DESC);
