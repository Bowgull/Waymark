-- Coach brain P4 (page 70 layout A, approved by Josh 2026-10-21): a slot per
-- MT class day. "mon:pm,sat:any" (am, pm or any). mt_class_days stays as it
-- is and still lists the days. A lit day missing here reads as its default:
-- PM on weekdays, ANY on Saturday and Sunday, so nothing changes until he taps.
--
-- Additive only: one nullable column. No existing row is changed.
ALTER TABLE `settings` ADD `mt_class_slots` text;
