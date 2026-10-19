-- Herb scale (approved 2026-10-19): the morning check-in's herb card drops
-- grams for a 0-9 scale. 0 = none, 1-9 where 9 = most.
--
-- Additive only: one new nullable column. No drops, no rewrites, no backfill.
-- weed_grams stays as it is: old gram values can't be converted to the scale,
-- so they are kept but nothing new writes them, and readiness, the Ledger and
-- the coach read herb_scale only.

ALTER TABLE daily_logs ADD COLUMN herb_scale INTEGER;
