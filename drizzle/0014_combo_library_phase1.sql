-- Phase 1: combo library additions (Sean Fagan canon + kick variety + defensive drills)
-- Bad-habit risk gated: question-mark kick and spinning back kick go to mastery tier.
-- Wall slip replaces swinging-bag slip drill to keep knees driving the defense.
-- Drill protocols (Fagan 100-teeps, 50+50 roundhouses, Sylvie foot-on-bag, Sylvie same-spot accuracy)
-- are woven into form_tips on existing isolated drill combos, not as new rows.
-- Uses INSERT OR IGNORE so user mastery/favourite state is never touched.

-- ── Foundation additions ─────────────────────────────────────────────────────

INSERT OR IGNORE INTO combos (id, text, tier, level, unlocked, mastery_score, techniques, form_tips, is_favourite, times_sharp, created_at)
VALUES ('combo-f10', 'Wall Slip → Cross', 'foundation', 'foundation', 1, 0, 'boxing,defensive',
  'Static slip against a wall or post, then drive the cross. Bend the knees. Chin tucks behind the lead shoulder. Head moves with the feet, never the waist. Head stays on its own line, posture does not collapse.',
  0, 0, strftime('%s', 'now'));

-- ── Weapons additions (Fagan canon + kick variety) ───────────────────────────

INSERT OR IGNORE INTO combos (id, text, tier, level, unlocked, mastery_score, techniques, form_tips, is_favourite, times_sharp, created_at)
VALUES ('combo-w12', 'Jab → Overhand → Left Kick', 'weapons', 'weapons', 0, 0, 'boxing,kicks',
  'Fagan canon. The overhand drops the lead shoulder and loads the kick. Do not overcommit the overhand. If it misses, the left kick punishes the turn.',
  0, 0, strftime('%s', 'now'));

INSERT OR IGNORE INTO combos (id, text, tier, level, unlocked, mastery_score, techniques, form_tips, is_favourite, times_sharp, created_at)
VALUES ('combo-w13', 'Hook → Low Kick', 'weapons', 'weapons', 0, 0, 'boxing,kicks',
  'Fagan canon. Hook lands high, low kick chops low. Two levels, one rhythm. Plant before the kick. Do not lean into the hook.',
  0, 0, strftime('%s', 'now'));

INSERT OR IGNORE INTO combos (id, text, tier, level, unlocked, mastery_score, techniques, form_tips, is_favourite, times_sharp, created_at)
VALUES ('combo-w14', 'Switch Kick → Switch Hook', 'weapons', 'weapons', 0, 0, 'boxing,kicks',
  'Fagan canon. Kick-first rhythm for a kick-strong fighter. Snap the feet on the switch, kick, then the hook rides the same hip turn. Return to orthodox immediately.',
  0, 0, strftime('%s', 'now'));

INSERT OR IGNORE INTO combos (id, text, tier, level, unlocked, mastery_score, techniques, form_tips, is_favourite, times_sharp, created_at)
VALUES ('combo-w15', 'Lead Teep → Heavy Rear Low Kick', 'weapons', 'weapons', 0, 0, 'kicks,defensive',
  'Fagan canon. The lead teep sets range and interrupts their rhythm. The rear low kick is the payment. Commit only to the kick, not the teep. Teep is setup.',
  0, 0, strftime('%s', 'now'));

INSERT OR IGNORE INTO combos (id, text, tier, level, unlocked, mastery_score, techniques, form_tips, is_favourite, times_sharp, created_at)
VALUES ('combo-w16', 'Switch Teep', 'weapons', 'weapons', 0, 0, 'defensive',
  'Lead-leg teep from the switch. The switch disguises the chamber. Hip drives, leg follows. Useful when the orthodox teep is getting read.',
  0, 0, strftime('%s', 'now'));

INSERT OR IGNORE INTO combos (id, text, tier, level, unlocked, mastery_score, techniques, form_tips, is_favourite, times_sharp, created_at)
VALUES ('combo-w17', 'Axe Kick', 'weapons', 'weapons', 0, 0, 'kicks',
  'Chamber high, drop the heel through the target on the descent. Your TKD base makes this one natural. Do not sacrifice balance for height. Recover to guard, not to a TKD stance.',
  0, 0, strftime('%s', 'now'));

INSERT OR IGNORE INTO combos (id, text, tier, level, unlocked, mastery_score, techniques, form_tips, is_favourite, times_sharp, created_at)
VALUES ('combo-w18', 'Check → Cross → Low Kick', 'weapons', 'weapons', 0, 0, 'boxing,kicks,defensive',
  'Defensive reaction drill. Check lifts sharp, cross fires off the same-side hip, low kick chops as you plant. The check is not passive. It is the first strike of the combo.',
  0, 0, strftime('%s', 'now'));

-- ── Deception additions (knees-gated) ────────────────────────────────────────

INSERT OR IGNORE INTO combos (id, text, tier, level, unlocked, mastery_score, techniques, form_tips, is_favourite, times_sharp, created_at)
VALUES ('combo-d10', 'Teep → Fake Teep → Step Knee', 'deception', 'deception', 1, 0, 'defensive,knees',
  'Fagan canon. Real teep, then sell the fake chamber, then step through into a knee. Their guard resets for a teep that is not coming. Drive the knee up and through on the step.',
  0, 0, strftime('%s', 'now'));

-- ── Mastery additions (tier-gated to keep bad-habit moves out of early work) ──

INSERT OR IGNORE INTO combos (id, text, tier, level, unlocked, mastery_score, techniques, form_tips, is_favourite, times_sharp, created_at)
VALUES ('combo-m08', 'Question-mark Kick', 'mastery', 'mastery', 0, 0, 'kicks',
  'Sell the low kick with the chamber, then whip the shin up and over the guard to the head or body. Commitment to the feint is the move. Reserved for mastery because a weak feint makes it a telegraphed head kick.',
  0, 0, strftime('%s', 'now'));

INSERT OR IGNORE INTO combos (id, text, tier, level, unlocked, mastery_score, techniques, form_tips, is_favourite, times_sharp, created_at)
VALUES ('combo-m09', 'Spinning Back Kick', 'mastery', 'mastery', 0, 0, 'kicks',
  'Step, turn, look, kick. Eyes find the target before the kick fires. Heel strikes through. Reserved for mastery because spinning on empty air cements bad footwork fast. Land back in orthodox, not in a drift.',
  0, 0, strftime('%s', 'now'));

-- ── Form tips updates: bake Fagan + Sylvie drill protocols into existing combos ─
-- These drills do not become new rows. They become the "how to drill" notes on
-- the isolated single-technique combos so the AI can cite them when prescribing
-- a drill-isolation round.

UPDATE combos SET form_tips = 'Drive the hip forward, not the leg. Snap the foot back to guard immediately. This is your range finder. Drill protocol (Fagan): 5 sets of 10 alternating legs, timed to the bag swing. Accuracy drill (Sylvie): hit the same spot repeatedly, bag should not spin. Form drill (Sylvie): place the foot on a still bag, then push with the hip, the leg cannot contribute power this way.'
WHERE id = 'combo-f07';

UPDATE combos SET form_tips = 'Pivot the base foot ninety degrees. Hip turns fully at impact, belly button faces the bag. Shin contacts the bag, not the foot. Chamber, drive, return. Drill protocol (Fagan): 50 per leg, moving around the bag, vary target height each set.'
WHERE id = 'combo-f09';
