-- When the coach opened a combo (page 93, approved 2026-10-25): the unlock card
-- offers 3 or 4 combos at a time, and each one he keeps is NEW on his bag
-- boards for two weeks, learnt slow in a technique round before it is thrown
-- at pace. Unix seconds; NULL for every combo opened before this (they are not
-- new).
--
-- Additive only: one nullable column. No existing row is changed.
ALTER TABLE `combos` ADD `unlocked_at` integer;
