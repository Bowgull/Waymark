-- G1/G2: data-loss and training-safety fixes. Additive only: new tables, new
-- nullable (or defaulted) columns, INSERT OR IGNORE library rows. No drops, no
-- rewrites of user data. Applied with `wrangler d1 migrations apply`.

-- Idempotent writes (first slice of the offline outbox). A write carrying an
-- Idempotency-Key is claimed here before it runs (status 0 = in flight) and
-- its response stored after (status = the HTTP status). A replay with the same
-- key gets the stored response and writes nothing. The nightly cron prunes
-- rows older than 7 days.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY NOT NULL,
  route TEXT NOT NULL,
  status INTEGER NOT NULL DEFAULT 0,
  response_body TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_idem_created ON idempotency_keys(created_at);

-- Strava activities the athlete marked "not training". Ingest skips them, so a
-- dismissed activity doesn't come back on the next poll.
CREATE TABLE IF NOT EXISTS strava_dismissed (
  activity_id INTEGER PRIMARY KEY NOT NULL,
  dismissed_at INTEGER NOT NULL
);

-- When the Strava activity started and ended (unix seconds). Confirming a match
-- stamps the session with the run's time, not the tap time.
ALTER TABLE run_sessions ADD COLUMN activity_start_at INTEGER;
ALTER TABLE run_sessions ADD COLUMN activity_end_at INTEGER;

-- Mobility rows carry their own prescription (reps, per side, notes, section),
-- so an exercise shared by two templates shows the right cues. Rows written
-- before this migration fall back to the template lookup.
ALTER TABLE posture_session_exercises ADD COLUMN reps INTEGER;
ALTER TABLE posture_session_exercises ADD COLUMN per_side INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posture_session_exercises ADD COLUMN notes TEXT;
ALTER TABLE posture_session_exercises ADD COLUMN section TEXT;

-- Back Care trunk work the routine needs (McGill-style options: reasonable,
-- not superior) and the dynamic run-walk warm-up. Bodyweight, no videos yet.
INSERT OR IGNORE INTO exercises (id, name, category, muscle_groups, equipment, form_cues, form_video_url, created_at) VALUES
('ex-side-plank-knees', 'Side Plank (Knees)', 'core', 'obliques,quadratus_lumborum,glutes', 'bodyweight', 'Lie on your side, elbow under the shoulder, knees bent behind you. Lift the hips so knees, hips and shoulders line up. Breathe normally. Lower before the hips sag.', NULL, strftime('%s','now')),
('ex-side-plank', 'Side Plank', 'core', 'obliques,quadratus_lumborum,glutes', 'bodyweight', 'Elbow under the shoulder, legs straight, feet stacked or staggered. Lift the hips into one straight line from head to heels. Breathe normally. Stop before the hips sag or the shoulder complains.', NULL, strftime('%s','now')),
('ex-mcgill-curl-up', 'McGill Curl-Up', 'core', 'abs,core', 'bodyweight', 'On your back, one knee bent, one leg straight, hands under the low back to keep its natural curve. Brace lightly and lift the head and shoulders a few centimetres as one unit. No chin tuck, no neck crank. Hold, then lower.', NULL, strftime('%s','now')),
('ex-hip-hinge-dowel', 'Hip Hinge Drill (Dowel)', 'mobility', 'hamstrings,glutes,back', 'bodyweight', 'Hold a dowel or broom along your back, touching the head, upper back and tailbone. Soft knees. Push the hips back until you feel the hamstrings, keeping all three contact points. Stand by squeezing the glutes. Teaches the hinge without load.', NULL, strftime('%s','now')),
('ex-brisk-walk', 'Brisk Walk', 'mobility', 'full_body', 'bodyweight', 'Walk at a pace that raises your breathing but still lets you talk. Swing the arms. Warms the legs and back before the first run interval.', NULL, strftime('%s','now')),
('ex-leg-swings', 'Leg Swings', 'mobility', 'hip_flexors,hamstrings,adductors', 'bodyweight', 'Hand on a wall or post. Swing one leg forward and back, small at first, a little bigger each swing. Stay tall, the swing comes from the hip, not the low back. Then side to side across the body.', NULL, strftime('%s','now')),
('ex-ankle-rocks', 'Ankle Rocks', 'mobility', 'calves,ankles', 'bodyweight', 'Staggered stance, hands on a wall. Bend the front knee forward over the toes and back, heel stays down. Smooth and controlled. Opens the ankle for the run.', NULL, strftime('%s','now')),
('ex-hip-circles', 'Standing Hip Circles', 'mobility', 'hips,glutes', 'bodyweight', 'Hands on hips or a wall. Lift one knee and draw a slow circle out to the side and back, then reverse. Keep the trunk still. Easy range, no forcing.', NULL, strftime('%s','now')),
('ex-high-knee-march', 'High-Knee March', 'mobility', 'hip_flexors,calves,core', 'bodyweight', 'March on the spot or forward. Drive one knee to hip height, opposite arm swings, rise onto the ball of the standing foot. Tall posture, ribs down. Progress to A-skips if it feels easy.', NULL, strftime('%s','now'));
