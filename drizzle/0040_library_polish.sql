-- Library polish and item pages (page 65, approved by Josh 2026-10-20).
-- Each item page shows one short cue line and keeps the rest behind MORE.
-- Most cue lines are the cue's first sentence (worked out in the app); where
-- that is long (Jab) or not the key point (Run-Walk), page 65 wrote a shorter
-- line, and the squat's coach note is shortened (its hint repeated the board
-- above it). The full cue, tips and hint all stay as they are.
--
-- Additive only: four new nullable columns and three rows updated by id. No
-- drops, no rewrites, no user data touched.

-- The one cue line, when it isn't the cue's first sentence.
ALTER TABLE exercises ADD COLUMN cue_line TEXT;
ALTER TABLE techniques ADD COLUMN cue_line TEXT;
ALTER TABLE run_types ADD COLUMN cue_line TEXT;
-- The coach note under MORE, when the hint is shortened for it.
ALTER TABLE exercises ADD COLUMN coach_note TEXT;

UPDATE techniques SET cue_line = 'Lead hand straight out, turn the fist over, straight back to the chin.' WHERE id = 'tech-jab';
UPDATE run_types SET cue_line = 'Walk before you need to.' WHERE id = 'run-walk';
UPDATE exercises SET coach_note = 'Your main squat from week 3. Sets of 8, 2–3 reps left.' WHERE id = 'ex-front-squat';
