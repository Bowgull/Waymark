-- Two kick combos a kru teaches first move into Fundamentals
-- (2026-10-26): Jab → Body Kick and Hook → Low Kick. Fundamentals is the open
-- level, so both are open; their switch (KICKS) still gates them in a round.
-- Mastery, favourites, ratings, cue and video are not touched. By id only.
UPDATE combos SET tier = 'foundation', level = 'foundation', unlocked = 1, coach_hint = 'Open. In your Fundamentals rounds; rate it after each round to build mastery.' WHERE id = 'combo-w01';
UPDATE combos SET tier = 'foundation', level = 'foundation', unlocked = 1, coach_hint = 'Open. In your Fundamentals rounds; rate it after each round to build mastery.' WHERE id = 'combo-w13';
