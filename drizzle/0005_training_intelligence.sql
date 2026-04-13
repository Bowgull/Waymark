-- Training Intelligence: week adjustments, adaptive generation
-- Tracks proposed/accepted/rejected adjustments to weekly plans

CREATE TABLE week_adjustments (
  id TEXT PRIMARY KEY,
  week_plan_id TEXT NOT NULL REFERENCES week_plans(id),
  adjustment_type TEXT NOT NULL,  -- 'skip_reschedule' | 'deficit_carryforward' | 'wellness_adapt' | 'pattern_adjust'
  session_type TEXT NOT NULL,
  action TEXT NOT NULL,           -- 'add' | 'swap' | 'remove' | 'move_timeslot'
  reason TEXT NOT NULL,
  target_day INTEGER,             -- day of week (0-6) for the proposed session
  target_time_slot TEXT,          -- 'am' | 'pm'
  source_data TEXT,               -- JSON: wellness snapshot, skip context
  status TEXT NOT NULL DEFAULT 'proposed',  -- 'proposed' | 'accepted' | 'rejected'
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_wa_week ON week_adjustments(week_plan_id);
CREATE INDEX idx_wa_status ON week_adjustments(status);

-- Add adjustment_id to sessions (links makeup sessions to their reason)
ALTER TABLE sessions ADD COLUMN adjustment_id TEXT REFERENCES week_adjustments(id);

-- Add analysis_json to week_plans (stores WeekAnalysis output)
ALTER TABLE week_plans ADD COLUMN analysis_json TEXT;
