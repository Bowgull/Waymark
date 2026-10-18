-- Foundation track (G2b): the daily back-and-neck session.
-- Library rows only, no user data:
-- 1) Shoulder rolls, used on the bad-neck day.
-- 2) Exercise cues that over-claimed (posture "fixes", muscles that sitting
--    "switches off", release and reset claims) rewritten in plain terms, per
--    the posture and back-care evidence review. seed.ts carries the same text.
INSERT OR IGNORE INTO exercises (id, name, category, muscle_groups, equipment, form_cues, form_video_url, created_at) VALUES
('ex-shoulder-rolls', 'Shoulder Rolls', 'posture', 'upper_traps,shoulders', 'bodyweight', 'Stand or sit tall. Slowly roll the shoulders up, back and down. Easy range, nothing that pinches. A gentle option on a sore-neck day.', NULL, strftime('%s','now'));

UPDATE exercises SET form_cues = 'Start lying on your back, head on the floor or a folded towel. Nod gently, as if saying "yes", so the back of the neck lengthens. Not a hard double chin. Hold 10s, 10 times. Trains the deep neck flexors. Progress to sitting against a wall.' WHERE id = 'ex-chin-tucks';
UPDATE exercises SET form_cues = 'Roller across the upper back, hands behind the head. Let the upper back extend over the roller, ribs down, low back stays out of it. Try 2-3 spots. Builds upper-back extension range and feels good; it does not fix posture on its own.' WHERE id = 'ex-foam-roll-thoracic';
UPDATE exercises SET form_cues = 'Forearm on the door frame, elbow at or just above shoulder height. One side at a time. Step through gently until you feel the front of the chest, nothing sharp in the shoulder. Hold 30s and breathe.' WHERE id = 'ex-doorway-pec-stretch';
UPDATE exercises SET form_cues = 'Ball against a wall, lean into the front of the chest. Roll slowly over tender spots and breathe. Short-term comfort and range, not a posture fix.' WHERE id = 'ex-foam-roll-pecs';
UPDATE exercises SET form_cues = 'Ball between the wall and the top of the shoulder, lean in and roll slowly with easy pressure. It can ease tension for a while; it does not change the muscle.' WHERE id = 'ex-foam-roll-traps';
UPDATE exercises SET form_cues = 'Face down, roller on the front of the hip. Roll slowly from the hip crease to mid-thigh. Short-term comfort before a stretch.' WHERE id = 'ex-foam-roll-hip-flexors';
UPDATE exercises SET form_cues = 'Back knee down, squeeze that glute and tuck your tailbone under. You should feel a gentle stretch in the front of the back hip. Optional after long sitting; nice, not a back-pain fix.' WHERE id = 'ex-hip-flexor-stretch';
UPDATE exercises SET form_cues = 'Face down or bent over. Make Y, T and W shapes with the arms, thumbs up, shoulder blades back and down. Slow and light. Trains the middle and lower trapezius.' WHERE id = 'ex-ytw-raises';
UPDATE exercises SET form_cues = 'Back against the wall, arms in goalpost position. Slide up and down, and only go as high as you can keep contact with the wall. Gentle shoulder and upper-back range.' WHERE id = 'ex-wall-angels';
UPDATE exercises SET form_cues = 'Squeeze the glutes to lift, don''t push through your lower back. Ribs down, tuck the tailbone slightly. Hold 2 seconds at the top. Builds hip extension strength.' WHERE id = 'ex-glute-bridges';
UPDATE exercises SET form_cues = 'On your back, band around the feet. Slow marching with the trunk braced, one knee toward the chest at a time. Hip flexor control and range.' WHERE id = 'ex-psoas-stretch';
UPDATE exercises SET form_cues = 'Seated, straighten one leg and gently rock the foot between pointed and flexed. Small, easy range, never into pain. If pain or tingling runs down the leg, stop and see a clinician.' WHERE id = 'ex-sciatic-nerve-glide';
UPDATE exercises SET form_cues = 'Face down, forehead on your hands. Slow breaths into the low back and sides. A calm way to start; it eases tension rather than fixing anything.' WHERE id = 'ex-crocodile-breathing';
UPDATE exercises SET form_cues = 'Lie face down, lift the chest and arms, thumbs up, shoulder blades back and down. Hold 3s. Trains the upper-back muscles.' WHERE id = 'ex-prone-cobra';
UPDATE exercises SET form_cues = 'Elbow tucked to your side, rotate the forearm outward against the band. Slow. Trains the rotator cuff (infraspinatus and teres minor).' WHERE id = 'ex-band-external-rotation';
UPDATE exercises SET form_cues = 'Back foot on the couch, front knee forward, tuck the tailbone and squeeze the back glute. 30s each side. A strong hip flexor stretch; optional.' WHERE id = 'ex-couch-stretch';
