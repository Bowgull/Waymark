-- Coach changes (page 56, approved 2026-10-19): every change to a session is
-- one row in week_adjustments, the athlete's own and the coach's, with
-- restorable before/after state, who made it, one plain why, and UNDO until
-- the session starts. The coach never asks any more: it applies, marks the day
-- with a rune and keeps the change undoable.
--
-- Additive only: new nullable or defaulted columns and indexes. No drops, no
-- rewrites, no backfill. Rows written before this migration keep kind NULL:
-- they never show as runes or in the week log, and nothing reads their old
-- 'proposed' status any more.

-- The athlete's action and everything the coach did because of it share one id.
ALTER TABLE week_adjustments ADD COLUMN change_set_id TEXT;

-- Who made it: 'you' | 'coach' | 'check_in' | 'weekly_pass' | 'class_tonight'.
ALTER TABLE week_adjustments ADD COLUMN actor TEXT;

-- What it was: 'swap' | 'skip' | 'add' | 'pull_forward' | 'move' | 'ease' |
-- 'shorten' | 'missed' | 'push' | 'make_regular' | 'tm'. NULL on legacy rows.
-- 'missed' is linked to the session it was missed from (target_session_id).
ALTER TABLE week_adjustments ADD COLUMN kind TEXT;

-- Restorable state, field by field (lib/coach/changes.ts ChangeState JSON):
-- the sessions' fields and context keys before and after, sessions it created,
-- and the before -> after words the screens show.
ALTER TABLE week_adjustments ADD COLUMN before_json TEXT;
ALTER TABLE week_adjustments ADD COLUMN after_json TEXT;

-- One plain line with the real numbers, and an optional second line.
ALTER TABLE week_adjustments ADD COLUMN why TEXT;
ALTER TABLE week_adjustments ADD COLUMN detail TEXT;

-- When UNDO stops: the affected session's planned start, as local wall-clock
-- seconds (epoch day x 86400 + time of day). UNDO also stops the moment the
-- session starts or is logged, whatever this says.
ALTER TABLE week_adjustments ADD COLUMN undo_until INTEGER;

-- Unix seconds: when it was undone, and when the athlete first opened it.
ALTER TABLE week_adjustments ADD COLUMN undone_at INTEGER;
ALTER TABLE week_adjustments ADD COLUMN seen_at INTEGER;

-- 1 = the athlete undid this coach change: the coach leaves that session as
-- he set it for the rest of the week.
ALTER TABLE week_adjustments ADD COLUMN held INTEGER NOT NULL DEFAULT 0;

-- The week's changes are read by set and by kind.
CREATE INDEX IF NOT EXISTS idx_wa_change_set ON week_adjustments(change_set_id);
CREATE INDEX IF NOT EXISTS idx_wa_kind_created ON week_adjustments(kind, created_at);
