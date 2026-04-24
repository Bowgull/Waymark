-- Curate form video library — 2026-04-23
-- Replaces 8 dead YouTube videos + upgrades 9 mid-trust picks to A-list creators
-- (Alan Thrall, Squat University, Yoga With Adriene).
-- Run with:
--   npx wrangler d1 execute waymark-db --local  --file=./src/db/curate_form_videos_2026_04.sql
--   npx wrangler d1 execute waymark-db --remote --file=./src/db/curate_form_videos_2026_04.sql
-- Idempotent.

-- Dead video replacements
UPDATE exercises SET form_video_url = 'https://www.youtube.com/watch?v=GVU4paANHoE' WHERE id = 'ex-walking-knee-hugs';
UPDATE exercises SET form_video_url = 'https://www.youtube.com/watch?v=yGN2Z6XkWNQ' WHERE id = 'ex-walking-quad-pulls';
UPDATE exercises SET form_video_url = 'https://www.youtube.com/watch?v=nOqMAsvRJ90' WHERE id = 'ex-spiderman-tspine';
UPDATE exercises SET form_video_url = 'https://www.youtube.com/watch?v=4NlJdSzHeUg' WHERE id = 'ex-lateral-lunges';
UPDATE exercises SET form_video_url = 'https://www.youtube.com/watch?v=GQg9L28bi1g' WHERE id = 'ex-a-skips';
UPDATE exercises SET form_video_url = 'https://www.youtube.com/watch?v=tlVT41u7bUQ' WHERE id = 'ex-toe-touch-forward-fold';
UPDATE exercises SET form_video_url = 'https://www.youtube.com/watch?v=b2DBNGlZfpo' WHERE id = 'ex-butterfly-stretch';
UPDATE exercises SET form_video_url = 'https://www.youtube.com/watch?v=f1HzSAuB-Vw' WHERE id = 'ex-standing-calf-stretch';

-- A-list creator upgrades
UPDATE exercises SET form_video_url = 'https://www.youtube.com/watch?v=G8l_8chR5BE' WHERE id = 'ex-bent-over-row';       -- Alan Thrall
UPDATE exercises SET form_video_url = 'https://www.youtube.com/watch?v=wYREQkVtvEc' WHERE id = 'ex-deadlift';             -- Alan Thrall
UPDATE exercises SET form_video_url = 'https://www.youtube.com/watch?v=tl6xvm4-Qk0' WHERE id = 'ex-glute-bridges';        -- Squat University
UPDATE exercises SET form_video_url = 'https://www.youtube.com/watch?v=0XVbn86Btj0' WHERE id = 'ex-dead-bugs';            -- Squat University
UPDATE exercises SET form_video_url = 'https://www.youtube.com/watch?v=y39PrKY_4JM' WHERE id = 'ex-cat-cow';              -- Yoga With Adriene
UPDATE exercises SET form_video_url = 'https://www.youtube.com/watch?v=wwKWBwj-05U' WHERE id = 'ex-doorway-pec-stretch';  -- Squat University
UPDATE exercises SET form_video_url = 'https://www.youtube.com/watch?v=Ms6VMXPq2uU' WHERE id = 'ex-pigeon-stretch';       -- Squat University
UPDATE exercises SET form_video_url = 'https://www.youtube.com/watch?v=tNHdx7pmrGI' WHERE id = 'ex-suitcase-carry';       -- Buff Dudes
UPDATE exercises SET form_video_url = 'https://www.youtube.com/watch?v=wGh2fZU20-M' WHERE id = 'ex-bird-dogs';            -- Mind Pump TV
