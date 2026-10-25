-- No overhands (Josh, 2026-10-25: not a good use of his bag time).
-- Removes the two overhand combos and the Overhand technique, only when no
-- logged round or rating uses them. The Left Kick page now points at the
-- combo that still uses it (Step Back Hook → Left Kick). No other row changes.
DELETE FROM combos WHERE id IN ('combo-w12', 'combo-fl12') AND id NOT IN (SELECT combo_id FROM bag_work_round_combos) AND id NOT IN (SELECT combo_id FROM combo_performance);
DELETE FROM techniques WHERE id = 'tech-overhand';
UPDATE techniques SET cue = 'Step through with the right foot, no switch, and kick with the left leg from the back.', coach_hint = 'Not a switch kick: the feet never swap. After a step-back hook, this is the left kick.' WHERE id = 'tech-left-kick';
