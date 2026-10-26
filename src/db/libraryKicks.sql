-- Kick combos into Fundamentals, the same rows as drizzle/0054_kick_combos_fundamentals.sql.
-- Appended to seed.sql after libraryLandmine.sql.
UPDATE combos SET tier = 'foundation', level = 'foundation', unlocked = 1, coach_hint = 'Open. In your Fundamentals rounds; rate it after each round to build mastery.' WHERE id = 'combo-w01';
UPDATE combos SET tier = 'foundation', level = 'foundation', unlocked = 1, coach_hint = 'Open. In your Fundamentals rounds; rate it after each round to build mastery.' WHERE id = 'combo-w13';
