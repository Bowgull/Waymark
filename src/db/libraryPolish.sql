-- The Library's short cue lines and the squat's coach note (page 65), the same rows as drizzle/0040_library_polish.sql.
-- Appended to seed.sql after libraryVideos.sql.
UPDATE techniques SET cue_line = 'Lead hand straight out, turn the fist over, straight back to the chin.' WHERE id = 'tech-jab';
UPDATE run_types SET cue_line = 'Walk before you need to.' WHERE id = 'run-walk';
UPDATE exercises SET coach_note = 'Your main squat from week 3. Sets of 8, 2–3 reps left.' WHERE id = 'ex-front-squat';
