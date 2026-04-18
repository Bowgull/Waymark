-- Phase 2: structured bag rounds.
-- roundType lets the AI prescribe a typed round (warmup, technical_flow,
-- drill_isolation, combo_practice, power, conditioning). No freestyle type.
-- coachRationale is the one-sentence voice-canon "why this round" line
-- shown in-session when the AI prescribed the round.

ALTER TABLE bag_work_rounds ADD COLUMN round_type TEXT NOT NULL DEFAULT 'combo_practice';
ALTER TABLE bag_work_rounds ADD COLUMN coach_rationale TEXT NOT NULL DEFAULT '';
