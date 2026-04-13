-- Seed: 60 days of realistic training history for Ledger dashboard demo
-- All timestamps are correct 2026 epoch seconds / epoch days
-- Run: npx wrangler d1 execute waymark-db --local --file=./src/db/seed-history.sql

-- ─── Training Block ──────────────────────────────────────────
INSERT OR IGNORE INTO training_blocks (id, name, total_weeks, started_at, status, created_at)
VALUES ('block-seed-1', '12-Week Base Build', 12, 1771390800, 'active', 1771390800);

-- ─── Training Maxes ──────────────────────────────────────────
INSERT OR REPLACE INTO training_maxes (id, exercise_id, weight_kg, updated_at)
VALUES
  ('tm-fs', 'ex-front-squat', 79.4, 1775966400),
  ('tm-bp', 'ex-bench-press', 72.6, 1775966400),
  ('tm-ohp', 'ex-ohp', 49.9, 1775966400),
  ('tm-row', 'ex-bent-over-row', 68.0, 1775966400),
  ('tm-rdl', 'ex-rdl', 90.7, 1775966400),
  ('tm-bp2', 'ex-block-pull', 102.1, 1775966400);

-- ─── Sessions: Week of Feb 23 (Mon epochDay=20507) ──────────
INSERT OR IGNORE INTO sessions (id, type, scheduled_date, time_slot, status, completed_at, duration_sec, rpe, difficulty, block_week, created_at) VALUES
('s-0223-fr1', 'foundation_run', 20507, 'am', 'completed', 1771844400, 2400, 5, 4, 1, 1771844400),
('s-0223-mt1', 'mt_class', 20507, 'pm', 'completed', 1771887600, 5400, 7, 6, 1, 1771887600),
('s-0224-str1', 'strength', 20508, 'am', 'completed', 1771930800, 4200, 7, 6, 1, 1771930800),
('s-0225-fr2', 'foundation_run', 20509, 'am', 'completed', 1772017200, 2700, 5, 4, 1, 1772017200),
('s-0225-mt2', 'mt_class', 20509, 'pm', 'completed', 1772060400, 5400, 7, 7, 1, 1772060400),
('s-0226-str2', 'strength', 20510, 'am', 'completed', 1772103600, 4500, 8, 7, 1, 1772103600),
('s-0227-fr3', 'foundation_run', 20511, 'am', 'completed', 1772190000, 2400, 4, 4, 1, 1772190000),
('s-0228-bag1', 'bag_work', 20512, 'am', 'completed', 1772276400, 1800, 6, 5, 1, 1772276400),
('s-0228-run1', 'running', 20512, 'am', 'completed', 1772280000, 1800, 7, 6, 1, 1772280000),
('s-0228-rec1', 'active_recovery', 20512, 'pm', 'completed', 1772319600, 1200, 2, 2, 1, 1772319600);

-- ─── Sessions: Week of Mar 2 (Mon epochDay=20514) ───────────
INSERT OR IGNORE INTO sessions (id, type, scheduled_date, time_slot, status, completed_at, duration_sec, rpe, difficulty, block_week, created_at) VALUES
('s-0302-fr1', 'foundation_run', 20514, 'am', 'completed', 1772449200, 2700, 5, 4, 2, 1772449200),
('s-0302-mt1', 'mt_class', 20514, 'pm', 'completed', 1772492400, 5400, 7, 6, 2, 1772492400),
('s-0303-str1', 'strength', 20515, 'am', 'completed', 1772535600, 4500, 7, 6, 2, 1772535600),
('s-0304-fr2', 'foundation_run', 20516, 'am', 'completed', 1772622000, 2400, 4, 4, 2, 1772622000),
('s-0304-mt2', 'mt_class', 20516, 'pm', 'skipped', NULL, NULL, NULL, NULL, 2, 1772665200),
('s-0305-str2', 'strength', 20517, 'am', 'completed', 1772708400, 4200, 8, 7, 2, 1772708400),
('s-0306-fr3', 'foundation_run', 20518, 'am', 'completed', 1772794800, 2700, 5, 5, 2, 1772794800),
('s-0307-bag1', 'bag_work', 20519, 'am', 'completed', 1772881200, 1800, 6, 5, 2, 1772881200),
('s-0307-run1', 'running', 20519, 'am', 'completed', 1772884800, 1800, 7, 7, 2, 1772884800);

-- ─── Sessions: Week of Mar 9 (Mon epochDay=20521) ───────────
INSERT OR IGNORE INTO sessions (id, type, scheduled_date, time_slot, status, completed_at, duration_sec, rpe, difficulty, block_week, created_at) VALUES
('s-0309-fr1', 'foundation_run', 20521, 'am', 'completed', 1773050400, 2700, 5, 4, 3, 1773050400),
('s-0309-mt1', 'mt_class', 20521, 'pm', 'completed', 1773093600, 5400, 7, 7, 3, 1773093600),
('s-0310-str1', 'strength', 20522, 'am', 'completed', 1773136800, 4800, 8, 7, 3, 1773136800),
('s-0311-fr2', 'foundation_run', 20523, 'am', 'completed', 1773223200, 2400, 4, 4, 3, 1773223200),
('s-0311-mt2', 'mt_class', 20523, 'pm', 'completed', 1773266400, 5400, 8, 7, 3, 1773266400),
('s-0312-str2', 'strength', 20524, 'am', 'completed', 1773309600, 4500, 7, 6, 3, 1773309600),
('s-0312-rec1', 'active_recovery', 20524, 'pm', 'completed', 1773352800, 1200, 2, 2, 3, 1773352800),
('s-0313-fr3', 'foundation_run', 20525, 'am', 'completed', 1773396000, 2400, 5, 4, 3, 1773396000),
('s-0313-mt3', 'mt_class', 20525, 'pm', 'completed', 1773439200, 5400, 7, 6, 3, 1773439200),
('s-0314-bag1', 'bag_work', 20526, 'am', 'completed', 1773482400, 1800, 7, 6, 3, 1773482400),
('s-0314-run1', 'running', 20526, 'am', 'completed', 1773486000, 1800, 7, 6, 3, 1773486000),
('s-0314-rec2', 'active_recovery', 20526, 'pm', 'completed', 1773525600, 1200, 2, 2, 3, 1773525600);

-- ─── Sessions: Week of Mar 16 (Mon epochDay=20528) ──────────
INSERT OR IGNORE INTO sessions (id, type, scheduled_date, time_slot, status, completed_at, duration_sec, rpe, difficulty, block_week, created_at) VALUES
('s-0316-fr1', 'foundation_run', 20528, 'am', 'completed', 1773655200, 2700, 5, 4, 4, 1773655200),
('s-0316-mt1', 'mt_class', 20528, 'pm', 'completed', 1773698400, 5400, 7, 6, 4, 1773698400),
('s-0317-str1', 'strength', 20529, 'am', 'completed', 1773741600, 4800, 8, 7, 4, 1773741600),
('s-0318-fr2', 'foundation_run', 20530, 'am', 'completed', 1773828000, 2400, 4, 4, 4, 1773828000),
('s-0318-mt2', 'mt_class', 20530, 'pm', 'completed', 1773871200, 5400, 8, 7, 4, 1773871200),
('s-0319-str2', 'strength', 20531, 'am', 'completed', 1773914400, 4500, 7, 7, 4, 1773914400),
('s-0319-rec1', 'active_recovery', 20531, 'pm', 'completed', 1773957600, 1200, 2, 2, 4, 1773957600),
('s-0320-fr3', 'foundation_run', 20532, 'am', 'completed', 1774000800, 2700, 5, 4, 4, 1774000800),
('s-0320-mt3', 'mt_class', 20532, 'pm', 'skipped', NULL, NULL, NULL, NULL, 4, 1774044000),
('s-0321-bag1', 'bag_work', 20533, 'am', 'completed', 1774087200, 1800, 6, 5, 4, 1774087200),
('s-0321-run1', 'running', 20533, 'am', 'completed', 1774090800, 2100, 8, 7, 4, 1774090800),
('s-0321-rec2', 'active_recovery', 20533, 'pm', 'completed', 1774130400, 1200, 2, 2, 4, 1774130400);

-- ─── Sessions: Week of Mar 23 (Mon epochDay=20535) ──────────
INSERT OR IGNORE INTO sessions (id, type, scheduled_date, time_slot, status, completed_at, duration_sec, rpe, difficulty, block_week, created_at) VALUES
('s-0323-fr1', 'foundation_run', 20535, 'am', 'completed', 1774260000, 2700, 4, 4, 5, 1774260000),
('s-0323-mt1', 'mt_class', 20535, 'pm', 'completed', 1774303200, 5400, 7, 6, 5, 1774303200),
('s-0324-str1', 'strength', 20536, 'am', 'completed', 1774346400, 4500, 7, 6, 5, 1774346400),
('s-0325-fr2', 'foundation_run', 20537, 'am', 'completed', 1774432800, 2400, 5, 4, 5, 1774432800),
('s-0325-mt2', 'mt_class', 20537, 'pm', 'completed', 1774476000, 5400, 7, 7, 5, 1774476000),
('s-0326-str2', 'strength', 20538, 'am', 'completed', 1774519200, 4800, 8, 7, 5, 1774519200),
('s-0326-rec1', 'active_recovery', 20538, 'pm', 'completed', 1774562400, 1200, 2, 2, 5, 1774562400),
('s-0327-fr3', 'foundation_run', 20539, 'am', 'completed', 1774605600, 2700, 5, 4, 5, 1774605600),
('s-0327-mt3', 'mt_class', 20539, 'pm', 'completed', 1774648800, 5400, 7, 6, 5, 1774648800),
('s-0328-bag1', 'bag_work', 20540, 'am', 'completed', 1774692000, 1800, 7, 6, 5, 1774692000),
('s-0328-run1', 'running', 20540, 'am', 'completed', 1774695600, 1800, 7, 6, 5, 1774695600),
('s-0328-rec2', 'active_recovery', 20540, 'pm', 'completed', 1774735200, 1200, 2, 2, 5, 1774735200);

-- ─── Sessions: Week of Mar 30 (Mon epochDay=20542) ──────────
INSERT OR IGNORE INTO sessions (id, type, scheduled_date, time_slot, status, completed_at, duration_sec, rpe, difficulty, block_week, created_at) VALUES
('s-0330-fr1', 'foundation_run', 20542, 'am', 'completed', 1774864800, 2700, 5, 4, 6, 1774864800),
('s-0330-mt1', 'mt_class', 20542, 'pm', 'completed', 1774908000, 5400, 8, 7, 6, 1774908000),
('s-0331-str1', 'strength', 20543, 'am', 'completed', 1774951200, 4800, 8, 7, 6, 1774951200),
('s-0401-fr2', 'foundation_run', 20544, 'am', 'completed', 1775037600, 2400, 5, 4, 6, 1775037600),
('s-0401-mt2', 'mt_class', 20544, 'pm', 'completed', 1775080800, 5400, 7, 6, 6, 1775080800),
('s-0402-str2', 'strength', 20545, 'am', 'completed', 1775124000, 4500, 7, 7, 6, 1775124000),
('s-0402-rec1', 'active_recovery', 20545, 'pm', 'completed', 1775167200, 1200, 2, 2, 6, 1775167200),
('s-0403-fr3', 'foundation_run', 20546, 'am', 'completed', 1775210400, 2700, 5, 4, 6, 1775210400),
('s-0403-mt3', 'mt_class', 20546, 'pm', 'completed', 1775253600, 5400, 7, 7, 6, 1775253600),
('s-0404-bag1', 'bag_work', 20547, 'am', 'completed', 1775296800, 1800, 6, 5, 6, 1775296800),
('s-0404-run1', 'running', 20547, 'am', 'completed', 1775300400, 2100, 7, 6, 6, 1775300400),
('s-0404-rec2', 'active_recovery', 20547, 'pm', 'completed', 1775340000, 1200, 2, 2, 6, 1775340000);

-- ─── Sessions: Week of Apr 6 (Mon epochDay=20549) CURRENT ───
INSERT OR IGNORE INTO sessions (id, type, scheduled_date, time_slot, status, completed_at, duration_sec, rpe, difficulty, block_week, created_at) VALUES
('s-0406-fr1', 'foundation_run', 20549, 'am', 'completed', 1775469600, 2700, 5, 4, 7, 1775469600),
('s-0406-mt1', 'mt_class', 20549, 'pm', 'completed', 1775512800, 5400, 7, 6, 7, 1775512800),
('s-0407-str1', 'strength', 20550, 'am', 'completed', 1775556000, 4800, 8, 7, 7, 1775556000),
('s-0408-fr2', 'foundation_run', 20551, 'am', 'completed', 1775642400, 2400, 4, 4, 7, 1775642400),
('s-0408-mt2', 'mt_class', 20551, 'pm', 'completed', 1775685600, 5400, 8, 7, 7, 1775685600),
('s-0409-str2', 'strength', 20552, 'am', 'completed', 1775728800, 4500, 7, 6, 7, 1775728800),
('s-0409-rec1', 'active_recovery', 20552, 'pm', 'completed', 1775772000, 1200, 2, 2, 7, 1775772000),
('s-0410-fr3', 'foundation_run', 20553, 'am', 'completed', 1775815200, 2700, 5, 4, 7, 1775815200),
('s-0410-mt3', 'mt_class', 20553, 'pm', 'completed', 1775858400, 5400, 7, 6, 7, 1775858400),
('s-0411-bag1', 'bag_work', 20554, 'am', 'completed', 1775901600, 1800, 7, 6, 7, 1775901600),
('s-0411-run1', 'running', 20554, 'am', 'completed', 1775905200, 2100, 7, 6, 7, 1775905200),
('s-0411-rec2', 'active_recovery', 20554, 'pm', 'completed', 1775944800, 1200, 2, 2, 7, 1775944800);

-- ─── Strength Session Exercises + Sets ───────────────────────

-- Week 5 Push (s-0324-str1): Front Squat, Bench, OHP, Incline DB, Lateral Raise
INSERT OR IGNORE INTO strength_session_exercises (id, session_id, exercise_id, order_index, section) VALUES
('sse-0324-1', 's-0324-str1', 'ex-front-squat', 1, 'main'),
('sse-0324-2', 's-0324-str1', 'ex-bench-press', 2, 'main'),
('sse-0324-3', 's-0324-str1', 'ex-ohp', 3, 'accessory'),
('sse-0324-4', 's-0324-str1', 'ex-incline-db-press', 4, 'accessory'),
('sse-0324-5', 's-0324-str1', 'ex-lateral-raise', 5, 'accessory');

INSERT OR IGNORE INTO strength_sets (id, session_exercise_id, set_number, weight_kg, reps, is_warmup, rest_sec, created_at) VALUES
('set-0324-1a', 'sse-0324-1', 1, 55.8, 5, 0, 180, 1774346400),
('set-0324-1b', 'sse-0324-1', 2, 55.8, 5, 0, 180, 1774346700),
('set-0324-1c', 'sse-0324-1', 3, 55.8, 5, 0, 180, 1774347000),
('set-0324-2a', 'sse-0324-2', 1, 52.2, 5, 0, 180, 1774347600),
('set-0324-2b', 'sse-0324-2', 2, 52.2, 5, 0, 180, 1774347900),
('set-0324-2c', 'sse-0324-2', 3, 52.2, 5, 0, 180, 1774348200),
('set-0324-3a', 'sse-0324-3', 1, 34.0, 8, 0, 120, 1774348800),
('set-0324-3b', 'sse-0324-3', 2, 34.0, 8, 0, 120, 1774349100),
('set-0324-3c', 'sse-0324-3', 3, 34.0, 7, 0, 120, 1774349400),
('set-0324-4a', 'sse-0324-4', 1, 20.4, 10, 0, 90, 1774350000),
('set-0324-4b', 'sse-0324-4', 2, 20.4, 10, 0, 90, 1774350300),
('set-0324-4c', 'sse-0324-4', 3, 20.4, 9, 0, 90, 1774350600),
('set-0324-5a', 'sse-0324-5', 1, 9.1, 12, 0, 60, 1774351200),
('set-0324-5b', 'sse-0324-5', 2, 9.1, 12, 0, 60, 1774351500),
('set-0324-5c', 'sse-0324-5', 3, 9.1, 11, 0, 60, 1774351800);

-- Week 5 Pull (s-0326-str2): Row, RDL, Block Pull, DB Row, Curl
INSERT OR IGNORE INTO strength_session_exercises (id, session_id, exercise_id, order_index, section) VALUES
('sse-0326-1', 's-0326-str2', 'ex-bent-over-row', 1, 'main'),
('sse-0326-2', 's-0326-str2', 'ex-rdl', 2, 'main'),
('sse-0326-3', 's-0326-str2', 'ex-block-pull', 3, 'main'),
('sse-0326-4', 's-0326-str2', 'ex-db-row', 4, 'accessory'),
('sse-0326-5', 's-0326-str2', 'ex-ez-curl', 5, 'accessory');

INSERT OR IGNORE INTO strength_sets (id, session_exercise_id, set_number, weight_kg, reps, is_warmup, rest_sec, created_at) VALUES
('set-0326-1a', 'sse-0326-1', 1, 49.9, 5, 0, 180, 1774519200),
('set-0326-1b', 'sse-0326-1', 2, 49.9, 5, 0, 180, 1774519500),
('set-0326-1c', 'sse-0326-1', 3, 49.9, 5, 0, 180, 1774519800),
('set-0326-2a', 'sse-0326-2', 1, 65.8, 5, 0, 180, 1774520400),
('set-0326-2b', 'sse-0326-2', 2, 65.8, 5, 0, 180, 1774520700),
('set-0326-2c', 'sse-0326-2', 3, 65.8, 5, 0, 180, 1774521000),
('set-0326-3a', 'sse-0326-3', 1, 74.8, 5, 0, 180, 1774521600),
('set-0326-3b', 'sse-0326-3', 2, 74.8, 5, 0, 180, 1774521900),
('set-0326-3c', 'sse-0326-3', 3, 74.8, 5, 0, 180, 1774522200),
('set-0326-4a', 'sse-0326-4', 1, 27.2, 10, 0, 90, 1774522800),
('set-0326-4b', 'sse-0326-4', 2, 27.2, 10, 0, 90, 1774523100),
('set-0326-4c', 'sse-0326-4', 3, 27.2, 9, 0, 90, 1774523400),
('set-0326-5a', 'sse-0326-5', 1, 20.4, 10, 0, 60, 1774524000),
('set-0326-5b', 'sse-0326-5', 2, 20.4, 10, 0, 60, 1774524300),
('set-0326-5c', 'sse-0326-5', 3, 20.4, 10, 0, 60, 1774524600);

-- Week 6 Push (s-0331-str1): heavier
INSERT OR IGNORE INTO strength_session_exercises (id, session_id, exercise_id, order_index, section) VALUES
('sse-0331-1', 's-0331-str1', 'ex-front-squat', 1, 'main'),
('sse-0331-2', 's-0331-str1', 'ex-bench-press', 2, 'main'),
('sse-0331-3', 's-0331-str1', 'ex-ohp', 3, 'accessory');

INSERT OR IGNORE INTO strength_sets (id, session_exercise_id, set_number, weight_kg, reps, is_warmup, rest_sec, created_at) VALUES
('set-0331-1a', 'sse-0331-1', 1, 59.9, 5, 0, 180, 1774951200),
('set-0331-1b', 'sse-0331-1', 2, 59.9, 5, 0, 180, 1774951500),
('set-0331-1c', 'sse-0331-1', 3, 59.9, 5, 0, 180, 1774951800),
('set-0331-2a', 'sse-0331-2', 1, 54.4, 5, 0, 180, 1774952400),
('set-0331-2b', 'sse-0331-2', 2, 54.4, 5, 0, 180, 1774952700),
('set-0331-2c', 'sse-0331-2', 3, 54.4, 5, 0, 180, 1774953000),
('set-0331-3a', 'sse-0331-3', 1, 37.6, 5, 0, 120, 1774953600),
('set-0331-3b', 'sse-0331-3', 2, 37.6, 5, 0, 120, 1774953900),
('set-0331-3c', 'sse-0331-3', 3, 37.6, 4, 0, 120, 1774954200);

-- Week 6 Pull (s-0402-str2): heavier
INSERT OR IGNORE INTO strength_session_exercises (id, session_id, exercise_id, order_index, section) VALUES
('sse-0402-1', 's-0402-str2', 'ex-bent-over-row', 1, 'main'),
('sse-0402-2', 's-0402-str2', 'ex-rdl', 2, 'main'),
('sse-0402-3', 's-0402-str2', 'ex-block-pull', 3, 'main');

INSERT OR IGNORE INTO strength_sets (id, session_exercise_id, set_number, weight_kg, reps, is_warmup, rest_sec, created_at) VALUES
('set-0402-1a', 'sse-0402-1', 1, 52.2, 5, 0, 180, 1775124000),
('set-0402-1b', 'sse-0402-1', 2, 52.2, 5, 0, 180, 1775124300),
('set-0402-1c', 'sse-0402-1', 3, 52.2, 5, 0, 180, 1775124600),
('set-0402-2a', 'sse-0402-2', 1, 68.0, 5, 0, 180, 1775125200),
('set-0402-2b', 'sse-0402-2', 2, 68.0, 5, 0, 180, 1775125500),
('set-0402-2c', 'sse-0402-2', 3, 68.0, 5, 0, 180, 1775125800),
('set-0402-3a', 'sse-0402-3', 1, 77.1, 5, 0, 180, 1775126400),
('set-0402-3b', 'sse-0402-3', 2, 77.1, 5, 0, 180, 1775126700),
('set-0402-3c', 'sse-0402-3', 3, 77.1, 5, 0, 180, 1775127000);

-- Week 7 Push (s-0407-str1): PR week, heavier singles
INSERT OR IGNORE INTO strength_session_exercises (id, session_id, exercise_id, order_index, section) VALUES
('sse-0407-1', 's-0407-str1', 'ex-front-squat', 1, 'main'),
('sse-0407-2', 's-0407-str1', 'ex-bench-press', 2, 'main'),
('sse-0407-3', 's-0407-str1', 'ex-ohp', 3, 'accessory'),
('sse-0407-4', 's-0407-str1', 'ex-incline-db-press', 4, 'accessory'),
('sse-0407-5', 's-0407-str1', 'ex-lateral-raise', 5, 'accessory');

INSERT OR IGNORE INTO strength_sets (id, session_exercise_id, set_number, weight_kg, reps, is_warmup, rest_sec, created_at) VALUES
('set-0407-1a', 'sse-0407-1', 1, 63.5, 3, 0, 240, 1775556000),
('set-0407-1b', 'sse-0407-1', 2, 63.5, 3, 0, 240, 1775556300),
('set-0407-1c', 'sse-0407-1', 3, 63.5, 3, 0, 240, 1775556600),
('set-0407-2a', 'sse-0407-2', 1, 58.1, 3, 0, 240, 1775557200),
('set-0407-2b', 'sse-0407-2', 2, 58.1, 3, 0, 240, 1775557500),
('set-0407-2c', 'sse-0407-2', 3, 58.1, 3, 0, 240, 1775557800),
('set-0407-3a', 'sse-0407-3', 1, 39.9, 5, 0, 120, 1775558400),
('set-0407-3b', 'sse-0407-3', 2, 39.9, 5, 0, 120, 1775558700),
('set-0407-3c', 'sse-0407-3', 3, 39.9, 4, 0, 120, 1775559000),
('set-0407-4a', 'sse-0407-4', 1, 22.7, 10, 0, 90, 1775559600),
('set-0407-4b', 'sse-0407-4', 2, 22.7, 10, 0, 90, 1775559900),
('set-0407-4c', 'sse-0407-4', 3, 22.7, 8, 0, 90, 1775560200),
('set-0407-5a', 'sse-0407-5', 1, 11.3, 12, 0, 60, 1775560800),
('set-0407-5b', 'sse-0407-5', 2, 11.3, 12, 0, 60, 1775561100),
('set-0407-5c', 'sse-0407-5', 3, 11.3, 10, 0, 60, 1775561400);

-- Week 7 Pull (s-0409-str2)
INSERT OR IGNORE INTO strength_session_exercises (id, session_id, exercise_id, order_index, section) VALUES
('sse-0409-1', 's-0409-str2', 'ex-bent-over-row', 1, 'main'),
('sse-0409-2', 's-0409-str2', 'ex-rdl', 2, 'main'),
('sse-0409-3', 's-0409-str2', 'ex-block-pull', 3, 'main'),
('sse-0409-4', 's-0409-str2', 'ex-db-row', 4, 'accessory'),
('sse-0409-5', 's-0409-str2', 'ex-ez-curl', 5, 'accessory');

INSERT OR IGNORE INTO strength_sets (id, session_exercise_id, set_number, weight_kg, reps, is_warmup, rest_sec, created_at) VALUES
('set-0409-1a', 'sse-0409-1', 1, 54.4, 3, 0, 240, 1775728800),
('set-0409-1b', 'sse-0409-1', 2, 54.4, 3, 0, 240, 1775729100),
('set-0409-1c', 'sse-0409-1', 3, 54.4, 3, 0, 240, 1775729400),
('set-0409-2a', 'sse-0409-2', 1, 72.6, 3, 0, 240, 1775730000),
('set-0409-2b', 'sse-0409-2', 2, 72.6, 3, 0, 240, 1775730300),
('set-0409-2c', 'sse-0409-2', 3, 72.6, 3, 0, 240, 1775730600),
('set-0409-3a', 'sse-0409-3', 1, 81.6, 3, 0, 240, 1775731200),
('set-0409-3b', 'sse-0409-3', 2, 81.6, 3, 0, 240, 1775731500),
('set-0409-3c', 'sse-0409-3', 3, 81.6, 3, 0, 240, 1775731800),
('set-0409-4a', 'sse-0409-4', 1, 29.5, 10, 0, 90, 1775732400),
('set-0409-4b', 'sse-0409-4', 2, 29.5, 10, 0, 90, 1775732700),
('set-0409-4c', 'sse-0409-4', 3, 29.5, 8, 0, 90, 1775733000),
('set-0409-5a', 'sse-0409-5', 1, 22.7, 10, 0, 60, 1775733600),
('set-0409-5b', 'sse-0409-5', 2, 22.7, 10, 0, 60, 1775733900),
('set-0409-5c', 'sse-0409-5', 3, 22.7, 9, 0, 60, 1775734200);

-- ─── Run Sessions ────────────────────────────────────────────
-- Progression runs (Saturday)
INSERT OR IGNORE INTO run_sessions (id, session_id, run_type, distance_km, duration_sec, pace_sec_km, is_indoor) VALUES
('rs-0228', 's-0228-run1', 'progression', 4.0, 1800, 450, 0),
('rs-0307', 's-0307-run1', 'progression', 4.2, 1800, 429, 0),
('rs-0314', 's-0314-run1', 'progression', 4.5, 1800, 400, 0),
('rs-0321', 's-0321-run1', 'progression', 4.8, 2100, 438, 0),
('rs-0328', 's-0328-run1', 'progression', 4.5, 1800, 400, 0),
('rs-0404', 's-0404-run1', 'progression', 5.0, 2100, 420, 0),
('rs-0411', 's-0411-run1', 'progression', 5.2, 2100, 404, 0);

-- Foundation runs (Zone 2)
INSERT OR IGNORE INTO run_sessions (id, session_id, run_type, distance_km, duration_sec, pace_sec_km, is_indoor) VALUES
('rs-fr-0302', 's-0302-fr1', 'zone2', 4.5, 2700, 600, 0),
('rs-fr-0304', 's-0304-fr2', 'zone2', 4.0, 2400, 600, 0),
('rs-fr-0306', 's-0306-fr3', 'zone2', 4.5, 2700, 600, 0),
('rs-fr-0309', 's-0309-fr1', 'zone2', 4.5, 2700, 600, 0),
('rs-fr-0311', 's-0311-fr2', 'zone2', 4.0, 2400, 600, 0),
('rs-fr-0313', 's-0313-fr3', 'zone2', 4.0, 2400, 600, 0),
('rs-fr-0316', 's-0316-fr1', 'zone2', 4.5, 2700, 600, 0),
('rs-fr-0318', 's-0318-fr2', 'zone2', 4.0, 2400, 600, 0),
('rs-fr-0320', 's-0320-fr3', 'zone2', 4.5, 2700, 600, 0),
('rs-fr-0323', 's-0323-fr1', 'zone2', 4.5, 2700, 600, 0),
('rs-fr-0325', 's-0325-fr2', 'zone2', 4.0, 2400, 600, 0),
('rs-fr-0327', 's-0327-fr3', 'zone2', 4.5, 2700, 600, 0),
('rs-fr-0330', 's-0330-fr1', 'zone2', 4.5, 2700, 600, 0),
('rs-fr-0401', 's-0401-fr2', 'zone2', 4.0, 2400, 600, 0),
('rs-fr-0403', 's-0403-fr3', 'zone2', 4.5, 2700, 600, 0),
('rs-fr-0406', 's-0406-fr1', 'zone2', 4.5, 2700, 600, 0),
('rs-fr-0408', 's-0408-fr2', 'zone2', 4.0, 2400, 600, 0),
('rs-fr-0410', 's-0410-fr3', 'zone2', 4.5, 2700, 600, 0);

-- ─── Daily Logs (wellness) ───────────────────────────────────
INSERT OR IGNORE INTO daily_logs (id, log_date, sleep_hours, weed_grams, alcohol_scale, soreness, notes, created_at) VALUES
('dl-0301', 20513, 7.0, 0.3, 0, 3, NULL, 1772427600),
('dl-0302', 20514, 6.5, 0.0, 0, 2, NULL, 1772449200),
('dl-0303', 20515, 7.5, 0.2, 0, 4, 'Sore from push day', 1772535600),
('dl-0304', 20516, 7.0, 0.0, 0, 3, NULL, 1772622000),
('dl-0305', 20517, 6.0, 0.0, 2, 5, 'Heavy pull, tired', 1772708400),
('dl-0306', 20518, 8.0, 0.0, 0, 3, NULL, 1772794800),
('dl-0307', 20519, 7.5, 0.5, 0, 2, NULL, 1772881200),
('dl-0308', 20520, 8.5, 0.0, 0, 1, 'Rest day', 1772967600),
('dl-0309', 20521, 7.0, 0.0, 0, 2, NULL, 1773050400),
('dl-0310', 20522, 6.5, 0.3, 0, 4, NULL, 1773136800),
('dl-0311', 20523, 7.5, 0.0, 0, 3, NULL, 1773223200),
('dl-0312', 20524, 7.0, 0.0, 0, 5, 'Heavy week catching up', 1773309600),
('dl-0313', 20525, 6.0, 0.0, 0, 3, NULL, 1773396000),
('dl-0314', 20526, 7.5, 0.3, 3, 2, 'Friday drinks', 1773482400),
('dl-0315', 20527, 8.0, 0.0, 0, 1, NULL, 1773568800),
('dl-0316', 20528, 7.0, 0.0, 0, 2, NULL, 1773655200),
('dl-0317', 20529, 7.0, 0.2, 0, 4, NULL, 1773741600),
('dl-0318', 20530, 7.5, 0.0, 0, 3, NULL, 1773828000),
('dl-0319', 20531, 6.5, 0.0, 0, 4, NULL, 1773914400),
('dl-0320', 20532, 7.0, 0.0, 0, 3, NULL, 1774000800),
('dl-0321', 20533, 8.0, 0.4, 2, 2, NULL, 1774087200),
('dl-0322', 20534, 8.5, 0.0, 0, 1, 'Rest day', 1774173600),
('dl-0323', 20535, 7.5, 0.0, 0, 2, NULL, 1774260000),
('dl-0324', 20536, 7.0, 0.2, 0, 3, NULL, 1774346400),
('dl-0325', 20537, 7.5, 0.0, 0, 3, NULL, 1774432800),
('dl-0326', 20538, 6.5, 0.0, 0, 5, 'Legs destroyed', 1774519200),
('dl-0327', 20539, 7.0, 0.0, 0, 3, NULL, 1774605600),
('dl-0328', 20540, 7.5, 0.3, 0, 2, NULL, 1774692000),
('dl-0329', 20541, 8.0, 0.0, 0, 1, NULL, 1774778400),
('dl-0330', 20542, 7.0, 0.0, 0, 2, NULL, 1774864800),
('dl-0331', 20543, 7.5, 0.2, 0, 4, NULL, 1774951200),
('dl-0401', 20544, 7.0, 0.0, 0, 3, NULL, 1775037600),
('dl-0402', 20545, 6.5, 0.0, 0, 4, NULL, 1775124000),
('dl-0403', 20546, 7.5, 0.0, 0, 3, NULL, 1775210400),
('dl-0404', 20547, 8.0, 0.4, 3, 2, 'Good Saturday', 1775296800),
('dl-0405', 20548, 8.5, 0.0, 0, 1, NULL, 1775383200),
('dl-0406', 20549, 7.0, 0.0, 0, 2, NULL, 1775469600),
('dl-0407', 20550, 7.0, 0.3, 0, 4, NULL, 1775556000),
('dl-0408', 20551, 7.5, 0.0, 0, 3, NULL, 1775642400),
('dl-0409', 20552, 7.0, 0.0, 0, 4, NULL, 1775728800),
('dl-0410', 20553, 6.5, 0.0, 0, 3, NULL, 1775815200),
('dl-0411', 20554, 7.5, 0.2, 0, 2, NULL, 1775901600),
('dl-0412', 20555, 7.0, 0.0, 0, 2, NULL, 1775988000);
