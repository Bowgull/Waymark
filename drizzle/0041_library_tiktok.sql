-- Library TikTok pass (approved by Josh 2026-10-20).
-- From waymark-research/library-tiktok-pass.csv (docs/library/library-tiktok-pass.csv).
--
-- Additive only: no new tables or columns, content rows updated by id. No user
-- data is touched or wiped.
--
-- Eight items get a TikTok as the MAIN video (combo-w01, w06, w04, w02, d06,
-- m03, w12, tech-overhand): the YouTube they had moves to tiktok_url, the
-- quiet second link, whichever host it is on. On tech-overhand that YouTube
-- is also the backup (alt_video_url), so a dead TikTok falls back to it.
-- Six combos keep their YouTube and get the TikTok as the second link
-- (combo-f03, w13, d09, m04, d02, f09). The weekly link check sets
-- video_status on the new mains (TikTok's oEmbed answers for any id, so it
-- can't tell live from gone).

-- TikTok becomes the main video; the YouTube it replaces is the quiet second link ("also on YouTube ›"). No start time on a TikTok.
UPDATE combos SET form_video_url = 'https://www.tiktok.com/@trainor103/video/7499869748306513174', video_start_sec = NULL, video_source = 'Damien Trainor (2x world champion, K-Star Legacy)', video_title = NULL, video_length = '0:26', video_status = 'unchecked', video_checked_at = NULL, tiktok_url = 'https://www.youtube.com/watch?v=SOgUZwx5bw4&t=8' WHERE id = 'combo-w01';
UPDATE combos SET form_video_url = 'https://www.tiktok.com/@trainor103/video/7499869748306513174', video_start_sec = NULL, video_source = 'Damien Trainor (2x world champion, K-Star Legacy)', video_title = NULL, video_length = '0:26', video_status = 'unchecked', video_checked_at = NULL, tiktok_url = 'https://www.youtube.com/watch?v=SOgUZwx5bw4&t=8' WHERE id = 'combo-w06';
UPDATE combos SET form_video_url = 'https://www.tiktok.com/@trainor103/video/7499869748306513174', video_start_sec = NULL, video_source = 'Damien Trainor (2x world champion, K-Star Legacy)', video_title = NULL, video_length = '0:26', video_status = 'unchecked', video_checked_at = NULL, tiktok_url = 'https://www.youtube.com/watch?v=6cEmE2W6liE' WHERE id = 'combo-w04';
UPDATE combos SET form_video_url = 'https://www.tiktok.com/@trainor103/video/7324726036044811552', video_start_sec = NULL, video_source = 'Damien Trainor (2x world champion, K-Star Legacy)', video_title = NULL, video_length = '0:26', video_status = 'unchecked', video_checked_at = NULL, tiktok_url = 'https://www.youtube.com/shorts/zOq6jePm7Ow' WHERE id = 'combo-w02';
UPDATE combos SET form_video_url = 'https://www.tiktok.com/@trainor103/video/7499869748306513174', video_start_sec = NULL, video_source = 'Damien Trainor (2x world champion, K-Star Legacy)', video_title = NULL, video_length = '0:26', video_status = 'unchecked', video_checked_at = NULL, tiktok_url = 'https://www.youtube.com/watch?v=7rlAj7pyvnE' WHERE id = 'combo-d06';
UPDATE combos SET form_video_url = 'https://www.tiktok.com/@trainor103/video/7211476819998969093', video_start_sec = NULL, video_source = 'Damien Trainor (2x world champion, K-Star Legacy)', video_title = NULL, video_length = '0:36', video_status = 'unchecked', video_checked_at = NULL, tiktok_url = 'https://www.youtube.com/watch?v=u6p4YKrvTwg&t=24' WHERE id = 'combo-m03';
UPDATE combos SET form_video_url = 'https://www.tiktok.com/@trainor103/video/7143247780805479685', video_start_sec = NULL, video_source = 'Damien Trainor (2x world champion, K-Star Legacy)', video_title = NULL, video_length = '1:13', video_status = 'unchecked', video_checked_at = NULL, tiktok_url = 'https://www.youtube.com/watch?v=rTTEn0RQQsw&t=57' WHERE id = 'combo-w12';
UPDATE techniques SET form_video_url = 'https://www.tiktok.com/@trainor103/video/7143247780805479685', video_start_sec = NULL, video_source = 'Damien Trainor (2x world champion, K-Star Legacy)', video_title = NULL, video_length = '1:13', video_status = 'unchecked', video_checked_at = NULL, tiktok_url = 'https://www.youtube.com/watch?v=rTTEn0RQQsw&t=57', alt_video_url = 'https://www.youtube.com/watch?v=rTTEn0RQQsw&t=57', alt_video_source = 'fightTIPS', alt_video_status = 'live' WHERE id = 'tech-overhand';
-- TikTok as the second link under the YouTube main ("also on TikTok ›").
UPDATE combos SET tiktok_url = 'https://www.tiktok.com/@trainor103/video/7400450559532109089' WHERE id = 'combo-f03';
UPDATE combos SET tiktok_url = 'https://www.tiktok.com/@trainor103/video/7324726036044811552' WHERE id = 'combo-w13';
UPDATE combos SET tiktok_url = 'https://www.tiktok.com/@trainor103/video/7499869748306513174' WHERE id = 'combo-d09';
UPDATE combos SET tiktok_url = 'https://www.tiktok.com/@trainor103/video/7324726036044811552' WHERE id = 'combo-m04';
UPDATE combos SET tiktok_url = 'https://www.tiktok.com/@trainor103/video/7324726036044811552' WHERE id = 'combo-d02';
UPDATE combos SET tiktok_url = 'https://www.tiktok.com/@fighttips/video/7660290014294723854' WHERE id = 'combo-f09';
