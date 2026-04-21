-- Codify the athlete's profile so every coach prompt reads the same durable
-- context. `goals` carries the multi-goal summary (MT love, bag drills, muscle
-- tone by 36, zone-2 5ks, longevity, UCS). `training_history` carries the
-- starter-context signal (sedentary, smoker, returning) that the
-- starterStatus helper keys on via the SEDENTARY_KEYWORDS regex.
--
-- Idempotent: only writes these fields if the row exists. If this is a fresh
-- DB with no profile row yet, the app's onboarding flow will still seed one.

UPDATE user_profile
SET
  goals = 'Get genuinely good at Muay Thai. Loves kicking the heavy bag solo at the 24h gym (2-minute round drills: switch kick, rear kick, teep). Build visible muscle tone and strength by 36 (Oct 2026). Longevity focus: stay mobile and capable into 50s/60s. UCS correction is a real goal, not a footnote. Zone-2 5k running as aerobic base and because MT culture runs them. More outdoor training as weather warms. Solo bag sessions are a core joy, not filler - protect them.',
  training_history = 'Lifelong athlete, natural mover, picks up movement skills fast (MT kick mechanics get complimented). Sedentary 2-3 years at a desk before starting this program; returning from long layoff. Heavy weed smoker, lungs compromised - VO2max depressed, recovery slower than textbook. Detrained on strength. No recent honest training baseline.',
  updated_at = strftime('%s', 'now')
WHERE id = 'default';
