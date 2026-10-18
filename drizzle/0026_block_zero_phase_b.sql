-- Block Zero Phase B: the data the rules need. Additive only: new nullable
-- columns, one new table, INSERT OR IGNORE library rows. No drops, no rewrites.
-- Applied with `wrangler d1 migrations apply` (tracked in d1_migrations).

-- Detailed daily check-in (readiness, R10). 1-5, higher is better except
-- stress (higher is worse). back_today is the back score the end gate trends.
ALTER TABLE daily_logs ADD COLUMN sleep_quality INTEGER;
ALTER TABLE daily_logs ADD COLUMN energy INTEGER;
ALTER TABLE daily_logs ADD COLUMN stress INTEGER;
ALTER TABLE daily_logs ADD COLUMN mood INTEGER;
ALTER TABLE daily_logs ADD COLUMN back_today INTEGER;
ALTER TABLE daily_logs ADD COLUMN back_notes TEXT;

-- Per-set effort: reps in reserve 0, 1, 2 or 3 (3 = "3 or more"). R1, R3, R4.
ALTER TABLE strength_sets ADD COLUMN rir INTEGER;

-- Muay thai class minutes for sRPE load (R5). class_type already exists.
ALTER TABLE mt_class_logs ADD COLUMN duration_min INTEGER;

-- Test-week and retest results (weeks 1, 3, 6 and extension weeks). One row per
-- block, week and test; re-entering a result updates it.
CREATE TABLE block_tests (
  id TEXT PRIMARY KEY NOT NULL,
  block_id TEXT NOT NULL REFERENCES training_blocks(id),
  week INTEGER NOT NULL,
  test_key TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT NOT NULL,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  recorded_at INTEGER NOT NULL
);
-- Also serves lookups by (block_id) and (block_id, week): leftmost prefix.
CREATE UNIQUE INDEX idx_block_tests_block_week_key ON block_tests(block_id, week, test_key);

-- Durability and back-friendly lifts the Block Zero rules use (R13, R14).
INSERT OR IGNORE INTO exercises (id, name, category, muscle_groups, equipment, form_cues, form_video_url, created_at) VALUES
('ex-neck-iso-4way', 'Neck Isometrics (4-Way)', 'strength', 'neck', 'bodyweight', 'Hand on the forehead, then the back of the head, then each side. Push into the hand and let nothing move. Hold each direction 10-20s at easy effort. Builds tolerance for clinch loading.', NULL, strftime('%s','now')),
('ex-wrist-curl', 'Wrist Curl', 'strength', 'forearms,grip', 'dumbbell,barbell', 'Forearms on the thighs or a bench, palms up. Lower the weight to the fingertips, then curl the wrist up. Slow on the way down.', NULL, strftime('%s','now')),
('ex-reverse-wrist-curl', 'Reverse Wrist Curl', 'strength', 'forearms,wrist_extensors', 'dumbbell,barbell', 'Forearms supported, palms down. Lift the back of the hand toward the ceiling, lower slowly. Light load. The extensors are smaller than the flexors.', NULL, strftime('%s','now')),
('ex-single-leg-calf-raise', 'Single-Leg Calf Raise', 'strength', 'calves,achilles', 'bodyweight,dumbbell', 'Ball of one foot on a step, light hand on a wall. Full stretch at the bottom, rise as high as you can, lower for 2-3s. Same reps each side.', NULL, strftime('%s','now')),
('ex-tibialis-raise', 'Tibialis Raise', 'strength', 'tibialis_anterior,shins', 'bodyweight', 'Back against a wall, heels a foot out. Pull the toes up toward the shins as high as they go, lower slowly. Step the feet further out to make it harder.', NULL, strftime('%s','now')),
('ex-trap-bar-deadlift', 'Trap-Bar Deadlift', 'strength', 'quads,glutes,hamstrings,back', 'trap_bar', 'Stand in the middle of the bar, handles at the sides. Hips back, chest tall, push the floor away. The load stays in line with you, so the torso stays more upright than a straight-bar pull.', NULL, strftime('%s','now'));
