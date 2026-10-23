-- Hard runs and the 5K (page 76, approved by Josh 2026-10-23).
--
-- settings.treadmill_unit: the treadmill speed unit he picked in Settings,
-- 'kmh' or 'mph'. NULL (not picked): every speed shows both units.
--
-- run_sessions.five_k_sec: a finished 5K test's time for the 5 km, in
-- seconds (run_type '5k_test'). Its time sets the next 4 weeks' speeds and
-- outdoor paces; Ledger reads the tests from here (src/server/fiveK.ts).
--
-- Additive only: two nullable columns. No existing row is changed.
ALTER TABLE `settings` ADD `treadmill_unit` text;
ALTER TABLE `run_sessions` ADD `five_k_sec` integer;
