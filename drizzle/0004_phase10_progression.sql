-- Phase 10: Combo Progression + Running Plan + Auto-Gen
-- Week plan auto-generation flag
ALTER TABLE week_plans ADD COLUMN auto_generated INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
-- Combo mastery + technique tags + favourites
ALTER TABLE combos ADD COLUMN mastery_score INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE combos ADD COLUMN techniques TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE combos ADD COLUMN is_favourite INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE combos ADD COLUMN times_sharp INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
-- Combo performance tracking
CREATE TABLE combo_performance (
  id TEXT PRIMARY KEY,
  combo_id TEXT NOT NULL REFERENCES combos(id),
  session_id TEXT NOT NULL REFERENCES sessions(id),
  round_id TEXT NOT NULL REFERENCES bag_work_rounds(id),
  rating INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_cp_combo ON combo_performance(combo_id);
--> statement-breakpoint
CREATE INDEX idx_cp_session ON combo_performance(session_id);
--> statement-breakpoint
-- Technique preferences in settings
ALTER TABLE settings ADD COLUMN enabled_techniques TEXT NOT NULL DEFAULT 'boxing,kicks,defensive';
