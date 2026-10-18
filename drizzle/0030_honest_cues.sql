-- Honest cues, part 2: the strength and hip-mobility cues that still
-- over-claimed (desk-posture fixes, "counters" for sitting or anterior pelvic
-- tilt, muscles that sitting "locks" or "closes off") rewritten as what to do
-- and how it should feel, per the posture and back-care evidence review.
-- Library rows only, no user data. seed.ts and seed.sql carry the same text.

UPDATE exercises SET form_cues = 'Hinge at the hips, flat back, brace. Pull the weight to the lower chest, squeeze the shoulder blades together at the top, then lower under control. You should feel the upper and middle back working, not the low back. Builds upper-back strength.' WHERE id = 'ex-bent-over-row';
UPDATE exercises SET form_cues = 'Rope at about face height. Pull toward your face with the elbows high, and turn the hands out so they finish beside the ears, pinkies back. Light and controlled. You should feel the back of the shoulders and between the shoulder blades. Trains the rear delts and rotator cuff.' WHERE id = 'ex-face-pulls';
UPDATE exercises SET form_cues = 'Dead hang, shoulder-width grip. Pull until your chin clears the bar, then lower under control to a full hang. You should feel the lats and upper back doing the work, not just the arms. Builds back and grip strength for clinch work.' WHERE id = 'ex-pullup';
UPDATE exercises SET form_cues = 'Front leg bent across in front of you, back leg extended behind. Sink the hips down only as far as is comfortable and breathe. You should feel a stretch in the outside of the front hip and glute, nothing in the knee. Hold 45s each side. Don''t force it.' WHERE id = 'ex-pigeon-stretch';
UPDATE exercises SET form_cues = 'Sit with both legs bent at 90 degrees, one in front and one to the side. Rotate the knees over to switch sides, smooth and controlled, hands behind you if needed. You should feel the hips turning in and out, nothing pinching. Hip rotation range for kicks.' WHERE id = 'ex-90-90-hip-switches';
UPDATE exercises SET form_cues = 'Step forward, lift one knee and hug it to your chest for a beat while standing tall on the other leg, then release and walk through. 6 per side. You should feel a stretch in the glute and back of the hugged leg. A dynamic hip warm-up.' WHERE id = 'ex-walking-knee-hugs';
UPDATE exercises SET form_cues = 'Sit with the soles of the feet together and let the knees fall open. Sit tall, then fold forward gently from the hips. You should feel a stretch along the inner thighs. 60s, breathing easy.' WHERE id = 'ex-butterfly-stretch';
UPDATE exercises SET form_cues = 'Stand tall, a hand on a wall if needed. Grab the ankle behind you, knees together, and squeeze the back glute. You should feel a stretch in the front of the thigh and hip. 30s each side.' WHERE id = 'ex-standing-quad-stretch';
