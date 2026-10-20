-- The Library's video start times and swaps, the same rows as drizzle/0039_library_videos.sql.
-- Appended to seed.sql after libraryContent.sql.
-- Start times: where the move starts in each long video (the CSV's evidence and confidence are in docs/library).
UPDATE exercises SET video_start_sec = 105 WHERE id = 'ex-bent-over-row';
UPDATE exercises SET video_start_sec = 156 WHERE id = 'ex-block-pull';
UPDATE exercises SET video_start_sec = 70 WHERE id = 'ex-pullup-band';
UPDATE exercises SET video_start_sec = 85 WHERE id = 'ex-hanging-leg-raise';
UPDATE exercises SET video_start_sec = 21 WHERE id = 'ex-cable-woodchop';
UPDATE exercises SET video_start_sec = 117 WHERE id = 'ex-a-skips';
UPDATE exercises SET video_start_sec = 131 WHERE id = 'ex-pigeon-stretch';
UPDATE combos SET video_start_sec = 4 WHERE id = 'combo-f09';
UPDATE combos SET video_start_sec = 57 WHERE id = 'combo-w12';
UPDATE combos SET video_start_sec = 9 WHERE id = 'combo-w17';
UPDATE techniques SET video_start_sec = 57 WHERE id = 'tech-overhand';
UPDATE techniques SET video_start_sec = 4 WHERE id = 'tech-roundhouse';
UPDATE techniques SET video_start_sec = 9 WHERE id = 'tech-axe-kick';
UPDATE techniques SET video_start_sec = 132 WHERE id = 'tech-horizontal-elbow';
UPDATE run_types SET video_start_sec = 21 WHERE id = 'run-walk';
UPDATE run_types SET video_start_sec = 55 WHERE id = 'run-5k-test';
-- The swaps: the new main video with its start time, coach, title and length; the TikTok as the second link.
UPDATE exercises SET form_video_url = 'https://www.youtube.com/shorts/SeHmHzj9KuQ', video_start_sec = 3, video_source = 'E3 Rehab', video_title = 'Hip Hinge Tips for Better RDLs', video_length = '1:05', video_status = 'live', video_checked_at = 1792495796, alt_video_url = 'https://www.youtube.com/watch?v=oSfNnSJWlMw', alt_video_source = 'E3 Rehab Exercise Library', alt_video_status = 'live' WHERE id = 'ex-hip-hinge-dowel';
UPDATE combos SET form_video_url = 'https://www.youtube.com/watch?v=HTts3Kk91ew', video_start_sec = 4, video_source = 'AKA Thailand (Kru Bird)', video_title = 'Muay Thai Basics: 1-2 Hook Combo - AKA Techniques', video_length = '0:46', video_status = 'live', video_checked_at = 1792495796, tiktok_url = 'https://www.tiktok.com/@trainor103/video/7324726036044811552' WHERE id = 'combo-f02';
UPDATE combos SET form_video_url = 'https://www.youtube.com/watch?v=LKxMYyHIpH8', video_start_sec = 14, video_source = 'Expert Boxing (Johnny Nguyen)', video_title = 'Basic Punch Combo (1-2-3-2)', video_length = '2:39', video_status = 'live', video_checked_at = 1792495796 WHERE id = 'combo-f04';
UPDATE combos SET form_video_url = 'https://www.youtube.com/watch?v=SOgUZwx5bw4', video_start_sec = 8, video_source = 'Empower Gym Tampa (James)', video_title = 'Jab - Cross - Rear Roundhouse Combination', video_length = '1:20', video_status = 'live', video_checked_at = 1792495796, tiktok_url = 'https://www.tiktok.com/@trainor103/video/7499869748306513174' WHERE id = 'combo-w01';
UPDATE combos SET form_video_url = 'https://www.youtube.com/watch?v=SOgUZwx5bw4', video_start_sec = 8, video_source = 'Empower Gym Tampa (James)', video_title = 'Jab - Cross - Rear Roundhouse Combination', video_length = '1:20', video_status = 'live', video_checked_at = 1792495796, tiktok_url = 'https://www.tiktok.com/@trainor103/video/7499869748306513174' WHERE id = 'combo-w06';
UPDATE combos SET form_video_url = 'https://www.youtube.com/watch?v=iMSkJPgN9Po', video_start_sec = NULL, video_source = 'Corey K', video_title = 'Muay Thai / Double Jab - Cross - L Hook - Round Kick - Long Knee Combo', video_length = '1:11', video_status = 'live', video_checked_at = 1792495796, tiktok_url = 'https://www.tiktok.com/@trainor103/video/7400450559532109089' WHERE id = 'combo-fl02';
UPDATE combos SET form_video_url = 'https://www.youtube.com/watch?v=PyLznOpQU0w', video_start_sec = 9, video_source = 'Evolve MMA (Hiroki Akimoto)', video_title = 'Muay Thai | How To Execute A Jab, Teep, Jab, Fake And Step In Knee Combination', video_length = '1:02', video_status = 'live', video_checked_at = 1792495796, tiktok_url = 'https://www.tiktok.com/@trainor103/video/7400450559532109089' WHERE id = 'combo-w11';
UPDATE combos SET form_video_url = 'https://www.youtube.com/watch?v=u6p4YKrvTwg', video_start_sec = 14, video_source = 'Tiger Muay Thai (Brad Riddell, with Dan Hooker)', video_title = 'Striking Technique Of The Week: Fake Low Kick to 1-2', video_length = '2:23', video_status = 'live', video_checked_at = 1792495796, tiktok_url = 'https://www.tiktok.com/@trainor103/video/7468272181814873376' WHERE id = 'combo-d03';
UPDATE combos SET form_video_url = 'https://www.youtube.com/watch?v=u6p4YKrvTwg', video_start_sec = 24, video_source = 'Tiger Muay Thai (Brad Riddell, with Dan Hooker)', video_title = 'Striking Technique Of The Week: Fake Low Kick to 1-2', video_length = '2:23', video_status = 'live', video_checked_at = 1792495796, tiktok_url = 'https://www.tiktok.com/@trainor103/video/7211476819998969093' WHERE id = 'combo-m03';
UPDATE combos SET form_video_url = 'https://www.youtube.com/watch?v=HYG6kcRYIZg', video_start_sec = 27, video_source = 'Warrior Collective (Damien Trainor, former world champion)', video_title = 'Muay Thai 5 Brutal Boxing to Elbow Drills Tutorial', video_length = '6:07', video_status = 'live', video_checked_at = 1792495796, tiktok_url = 'https://www.tiktok.com/@trainor103/video/7499869748306513174' WHERE id = 'combo-m07';
-- combo-w12: kept as it is (no reputable clip of the combo found); its start time is above.
