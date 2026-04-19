-- One-shot fix: replace 16 dead YouTube form videos with verified replacements.
-- Run with:
--   npx wrangler d1 execute waymark-db --local  --file=./src/db/fix_form_video_urls.sql
--   npx wrangler d1 execute waymark-db --remote --file=./src/db/fix_form_video_urls.sql
-- Idempotent — safe to re-run.

UPDATE exercises SET form_video_url = 'https://www.youtube.com/watch?v=z4JbDQHJ_2M' WHERE id = 'ex-foam-roll-hip-flexors';
UPDATE exercises SET form_video_url = 'https://www.youtube.com/watch?v=iq5D5SU2Oq4' WHERE id = 'ex-suitcase-carry';
UPDATE exercises SET form_video_url = 'https://www.youtube.com/watch?v=qq_Z7sAmVrA' WHERE id = 'ex-90-90-hip-switches';
UPDATE exercises SET form_video_url = 'https://www.youtube.com/watch?v=o4GKiEoYClI' WHERE id = 'ex-dead-bugs';
UPDATE exercises SET form_video_url = 'https://www.youtube.com/watch?v=a8KjvtbkM8E' WHERE id = 'ex-foam-roll-pecs';
UPDATE exercises SET form_video_url = 'https://www.youtube.com/watch?v=LWDUyq4TRMU' WHERE id = 'ex-prone-cobra';
UPDATE exercises SET form_video_url = 'https://www.youtube.com/watch?v=Dmm8_S23I74' WHERE id = 'ex-doorway-pec-stretch';
UPDATE exercises SET form_video_url = 'https://www.youtube.com/watch?v=vHIJgPO3p9Q' WHERE id = 'ex-psoas-stretch';
UPDATE exercises SET form_video_url = 'https://www.youtube.com/watch?v=4yE-XGDWJPg' WHERE id = 'ex-pullup-band';
UPDATE exercises SET form_video_url = 'https://www.youtube.com/watch?v=OMbKv94Bu_U' WHERE id = 'ex-sciatic-nerve-glide';
UPDATE exercises SET form_video_url = 'https://www.youtube.com/watch?v=2vwIdJbOqx4' WHERE id = 'ex-pigeon-stretch';
UPDATE exercises SET form_video_url = 'https://www.youtube.com/watch?v=RcwfX-YKnIw' WHERE id = 'ex-foam-roll-traps';
UPDATE exercises SET form_video_url = 'https://www.youtube.com/watch?v=R9HJnAdJAUs' WHERE id = 'ex-body-saw';
UPDATE exercises SET form_video_url = 'https://www.youtube.com/watch?v=ZR5t8K487dQ' WHERE id = 'ex-block-pull';
UPDATE exercises SET form_video_url = 'https://www.youtube.com/watch?v=UhgQi_cz5zA' WHERE id = 'ex-side-plank-lift';
UPDATE exercises SET form_video_url = 'https://www.youtube.com/watch?v=5kM-o61Z14I' WHERE id = 'ex-wall-hip-cars';
