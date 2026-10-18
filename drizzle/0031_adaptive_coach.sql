-- Adaptive coach (E3): the weekly pass, asks that push, and what changed and why.
-- Additive only: new nullable or defaulted columns and indexes. No drops, no
-- rewrites, no backfill. Old 'draft' week plans stay as they are and are read
-- as active (there is no approval step any more).

-- The week's one "why this week" line and when the coach prepared it.
-- Null on weeks written before this migration or made from the template only.
ALTER TABLE week_plans ADD COLUMN why_line TEXT;
ALTER TABLE week_plans ADD COLUMN prepared_at INTEGER;

-- 1 = the coach applied this change on its own (small change, with a note in
-- reason). 0 = everything else: asks, answered asks, legacy rows.
ALTER TABLE week_adjustments ADD COLUMN auto INTEGER NOT NULL DEFAULT 0;

-- When the athlete last opened the app (unix seconds), for the morning
-- "N changes, M questions" line.
ALTER TABLE settings ADD COLUMN coach_seen_at INTEGER;

-- Sessions the athlete chose to make regular (JSON array of
-- {blockId, type, label, notes, dayOfWeek, timeSlot, addedAt}). Placement-checked
-- each time a week is prepared.
ALTER TABLE settings ADD COLUMN template_extras TEXT;

-- One weekly pass per block and calendar week, even if the cron and the app race.
CREATE UNIQUE INDEX IF NOT EXISTS idx_coaching_weekly_pass ON coaching_outputs(kind, input_hash) WHERE kind = 'weekly_pass';

-- The morning summary reads changes by time.
CREATE INDEX IF NOT EXISTS idx_wa_created ON week_adjustments(created_at);
