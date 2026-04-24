-- One-shot manual insert of the Apr 22 2026 Zone 2 run.
-- The Zone 2 start bug (pre-0019) blocked logging on the day, and by the time
-- it was fixed the session had auto-rolled to 'missed'. Strava ingest under
-- the old Worker code matched on sessions.type='running' only, so the
-- foundation_run session never got the attachment either.
--
-- Strava activity summary (from user screenshot):
--   Date:        Apr 22 2026, 6:06 PM Toronto (= 22:06 UTC)
--   Distance:    2.65 km
--   Moving time: 17:57 (1077 s)
--   Pace:        6:46/km (406 s/km)
--   Avg HR:      156 bpm
--   Elev gain:   6 m
--
-- Epoch math:
--   scheduled_date (epoch day for Apr 22 2026): 20565
--   started_at    (epoch seconds, 22:06:00 UTC): 1776895560
--   completed_at  (started_at + 1077):           1776896637

-- Un-flip the Wed Apr 22 Zone 2 to completed.
UPDATE sessions
SET
  status       = 'completed',
  started_at   = 1776895560,
  completed_at = 1776896637,
  duration_sec = 1077
WHERE type = 'foundation_run'
  AND scheduled_date = 20565
  AND status IN ('missed', 'skipped', 'planned');

-- Attach the run data. INSERT OR IGNORE so rerunning is safe: the unique
-- index on session_id prevents a duplicate run_sessions row.
INSERT OR IGNORE INTO run_sessions (
  id, session_id, distance_km, duration_sec, pace_sec_km,
  is_indoor, avg_hr, elevation_gain_m, source, attachment_status
)
SELECT
  lower(hex(randomblob(16))),
  id,
  2.65,
  1077,
  406,
  0,
  156,
  6,
  'manual',
  NULL
FROM sessions
WHERE type = 'foundation_run'
  AND scheduled_date = 20565
  AND status = 'completed'
LIMIT 1;
