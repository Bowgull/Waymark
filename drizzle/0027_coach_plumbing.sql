-- Coach plumbing (Phase E1). Additive only: new nullable columns and indexes.
-- No drops, no rewrites, no backfill. Applied with `wrangler d1 migrations apply`.

-- Where a session came from: 'template' | 'ad_hoc' | 'coach' | 'replace'.
-- Null = unknown (rows written before this migration). The nightly ad-hoc
-- conflict check reads this instead of guessing from block_week.
ALTER TABLE sessions ADD COLUMN source TEXT;

-- Pending decisions the athlete answers (a missed session, a big coach change):
-- the session it is about, the safe options the rules computed (JSON), when it
-- lapses (unix seconds, end of the training week) and when it was answered.
-- status gains 'expired' next to 'proposed' | 'accepted' | 'rejected'.
ALTER TABLE week_adjustments ADD COLUMN target_session_id TEXT;
ALTER TABLE week_adjustments ADD COLUMN options_json TEXT;
ALTER TABLE week_adjustments ADD COLUMN expires_at INTEGER;
ALTER TABLE week_adjustments ADD COLUMN resolved_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_wa_target_session ON week_adjustments(target_session_id);
CREATE INDEX IF NOT EXISTS idx_wa_type_status ON week_adjustments(adjustment_type, status);
