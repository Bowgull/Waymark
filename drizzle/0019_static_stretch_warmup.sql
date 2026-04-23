-- Static pre-run stretch set. Replaces the dynamic FR_WARMUP_TEMPLATE
-- exercises (walking knee hugs, quad pulls, spiderman, lateral lunges,
-- A-skips) which shipped in 0015-era code but never got a migration, so the
-- FK insert into posture_session_exercises failed and Zone 2 sessions
-- couldn't start.
--
-- Pigeon already exists (ex-pigeon-stretch from original seed). Only the
-- four below are new. INSERT OR IGNORE so re-running is safe.

INSERT OR IGNORE INTO exercises (id, name, category, muscle_groups, equipment, form_cues, form_video_url, created_at) VALUES
  (
    'ex-toe-touch-forward-fold',
    'Toe-Touch Forward Fold',
    'posture',
    'hamstrings,calves,low_back',
    'bodyweight',
    'Feet hip-width, fold from the hips, let the head hang. Soft knees if the hamstrings grip. 45s. Full posterior chain opens in one move.',
    'https://www.youtube.com/watch?v=gcH5FWyOiaw',
    strftime('%s','now')
  ),
  (
    'ex-butterfly-stretch',
    'Butterfly Stretch',
    'posture',
    'adductors,hips',
    'bodyweight',
    'Soles together, knees fall open, fold forward from the hips. 60s. Adductor and inner-hip length sitting closes off.',
    'https://www.youtube.com/watch?v=LpMLUH1CM1k',
    strftime('%s','now')
  ),
  (
    'ex-standing-quad-stretch',
    'Standing Quad Stretch',
    'posture',
    'quads,hip_flexors',
    'bodyweight',
    'Stand, grab the ankle behind you, knees together, squeeze the back glute. 30s each side. Rectus femoris and hip flexor, direct counter to APT.',
    'https://www.youtube.com/watch?v=UGEpQ1BRx-4',
    strftime('%s','now')
  ),
  (
    'ex-standing-calf-stretch',
    'Standing Calf Stretch',
    'posture',
    'calves,achilles',
    'bodyweight',
    'Hands on wall, back leg straight, press the heel down. 30s each side. Gastrocnemius and Achilles, the chain that takes every step of impact.',
    'https://www.youtube.com/watch?v=Kz162ij1s7I',
    strftime('%s','now')
  );
