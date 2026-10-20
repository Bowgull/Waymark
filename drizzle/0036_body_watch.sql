-- Injury weather and the raven (page 58, approved 2026-10-19, all 17 items;
-- plan 2's bikes stay at the physio stage, "Not now" waits a day). When one
-- place keeps coming back in his own reports, the forest turns green and a
-- raven lands on the Morning Report with a note: what the coach noticed, why,
-- a plan with a set length. DO IT puts the plan on the week as ordinary coach
-- changes (week_adjustments rows, Dagaz and UNDO); the raven returns the
-- morning after the plan ends. One readjust, then "see a physio". Nothing
-- blocks. Rules: lib/coach/bodyWatch.ts. Server: server/bodyWatch.ts.
--
-- Additive only: one new table, two new nullable columns. No drops, no
-- rewrites, no backfill.

-- One row per episode per body place; at most one open (cleared_at NULL) per region.
CREATE TABLE IF NOT EXISTS body_alerts (
  id TEXT PRIMARY KEY,
  -- 'knee' | 'back' | ... (lib/coach/injury.ts normaliseRegion)
  region TEXT NOT NULL,
  -- The strongest pattern: 'comes_back' | 'slow' | 'not_easing' | 'picked_through'.
  "trigger" TEXT NOT NULL,
  -- Every pattern that fired, JSON array.
  triggers_json TEXT,
  -- Local epoch day it opened.
  opened_at INTEGER NOT NULL,
  -- Unix seconds he first opened the current note (the raven stops looking round).
  seen_at INTEGER,
  -- Local epoch day it cleared, and why: 'better' (FEELS BETTER) | 'quiet' (page 57's rule).
  cleared_at INTEGER,
  clear_reason TEXT,
  -- The reports (day, kind, text), his picks against it, the count and span.
  evidence_json TEXT,
  -- The load-jump line (context only) or NULL.
  context_line TEXT,
  -- The weather: 1 green rain, 2 downpour, 3 storm (recomputed in the server pass).
  level INTEGER NOT NULL DEFAULT 1,
  -- The level when he last answered (GOT IT / DO IT): stronger than this is loud again.
  acked_level INTEGER NOT NULL DEFAULT 0,
  -- Local epoch day the level last changed (one level down per better week).
  level_at INTEGER,
  -- watch | noted | plan1 | ask1 | offer2 | noted2 | plan2 | ask2 | physio | cleared
  stage TEXT NOT NULL DEFAULT 'watch',
  -- Plans made this episode: 0, 1 or 2 (never 3).
  plan_round INTEGER NOT NULL DEFAULT 0,
  -- Local epoch days: plan 1's first day; the current plan's first and last day;
  -- the day DO IT applied it; the day the raven returns (moved a day by "Not now").
  plan1_start INTEGER,
  plan_started_at INTEGER,
  plan_ends_at INTEGER,
  applied_on INTEGER,
  ask_on INTEGER,
  -- Each answer: [{ on, answer: 'better' | 'sore' }].
  answers_json TEXT,
  -- The week_adjustments rows DO IT wrote (UNDO and the step-up find them), JSON array.
  plan_change_ids TEXT,
  -- Plan changes for days whose sessions aren't made yet (applied when they are), JSON.
  pending_json TEXT,
  -- The current plan as the note showed it when DO IT applied it (lines, dates, preview), JSON.
  plan_json TEXT,
  -- FEELS BETTER: the step back up, as the good-news board lists it, JSON.
  step_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_body_alerts_region ON body_alerts(region, cleared_at);

-- "<Place> today" in the morning check-in while a place is on watch (page 57
-- item 6, kept on page 58): { "knee": 2 }, 1 bad .. 5 fine like Back today.
ALTER TABLE daily_logs ADD COLUMN region_ratings_json TEXT;

-- His pick of what the coach left out for a place on watch (T4, picked
-- through): the region, recorded quietly on his own change row. Never refused.
ALTER TABLE week_adjustments ADD COLUMN against_flag TEXT;
