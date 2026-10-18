-- Naruto progress for indoor runs, tracked like One Pace.
-- Additive only: two new nullable columns, no backfill.

-- Arc name from src/lib/naruto.ts (approximate table). Null = not set.
ALTER TABLE settings ADD COLUMN naruto_arc TEXT;
-- Next episode to watch, 1..220 (original series). Null = not set.
ALTER TABLE settings ADD COLUMN naruto_ep INTEGER;
