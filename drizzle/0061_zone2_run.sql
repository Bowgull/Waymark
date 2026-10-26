-- One name for one run (2026-10-26): "Zone 2 Run" everywhere, never "Easy Run".
-- The Library had the same run twice ("Zone 2" and "Easy Run"): it keeps one row, Zone 2 Run.
-- The strides run (a Zone 2 Run with fast bursts at the end) takes the name too.
-- Session rows already planned or logged read Zone 2 Run.
UPDATE run_types SET name = 'Zone 2 Run' WHERE id = 'run-zone2';
UPDATE run_types SET name = 'Zone 2 Run + Strides' WHERE id = 'run-strides';
DELETE FROM video_reviews WHERE item_kind = 'run' AND item_id = 'run-easy';
DELETE FROM run_types WHERE id = 'run-easy';
UPDATE sessions SET label = 'Zone 2 Run' WHERE label IN ('Zone 2', 'Easy Run');
