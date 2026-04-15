-- New combos: isolated single-technique drills, switch kicks, knees, elbows
-- Uses INSERT OR IGNORE so user progress (mastery_score, is_favourite) is never overwritten

-- ── Foundation additions (unlocked=1) — isolated technique drills ────────────
-- Give beginners a dedicated round for each fundamental tool without boxing combos

INSERT OR IGNORE INTO combos (id, text, tier, level, unlocked, mastery_score, techniques, form_tips, is_favourite, times_sharp, created_at)
VALUES ('combo-f07', 'Lead Teep', 'foundation', 'foundation', 1, 0, 'defensive',
  'Drive the hip forward, not just the leg. Snap the foot back to guard immediately. This is your range finder — use it to interrupt attacks and reset distance.',
  0, 0, strftime('%s', 'now'));

INSERT OR IGNORE INTO combos (id, text, tier, level, unlocked, mastery_score, techniques, form_tips, is_favourite, times_sharp, created_at)
VALUES ('combo-f08', 'Jab × 3', 'foundation', 'foundation', 1, 0, 'boxing',
  'Three snapping jabs, each with intent: find range, close, land. Retract fully between each. Quality over speed — a sloppy jab telegraphs everything.',
  0, 0, strftime('%s', 'now'));

INSERT OR IGNORE INTO combos (id, text, tier, level, unlocked, mastery_score, techniques, form_tips, is_favourite, times_sharp, created_at)
VALUES ('combo-f09', 'Rear Roundhouse', 'foundation', 'foundation', 1, 0, 'kicks',
  'Pivot the base foot 90°. Hip turns fully at impact — your belly button faces the bag. Shin contacts the bag, not the foot. Chamber, drive, return.',
  0, 0, strftime('%s', 'now'));

-- ── Weapons additions (switch kicks) ─────────────────────────────────────────
-- Switch kick drills to support isolated kick practice (Josh loves kicking)

INSERT OR IGNORE INTO combos (id, text, tier, level, unlocked, mastery_score, techniques, form_tips, is_favourite, times_sharp, created_at)
VALUES ('combo-w08', 'Switch Kick', 'weapons', 'weapons', 0, 0, 'kicks',
  'Snap the feet fast — the weight transfer is what fires the kick, not the leg swing. Hip rotation drives through the shin. Return to orthodox immediately.',
  0, 0, strftime('%s', 'now'));

INSERT OR IGNORE INTO combos (id, text, tier, level, unlocked, mastery_score, techniques, form_tips, is_favourite, times_sharp, created_at)
VALUES ('combo-w09', 'Switch Kick → Cross → Hook', 'weapons', 'weapons', 0, 0, 'boxing,kicks',
  'Open with the switch kick to disrupt their timing and set distance, then flow directly into the hands. The kick creates the opening — exploit it fast.',
  0, 0, strftime('%s', 'now'));

-- ── Weapons additions (knees) — unlocked=1, gated by knees setting ───────────
-- Immediately available when user enables knees in Settings

INSERT OR IGNORE INTO combos (id, text, tier, level, unlocked, mastery_score, techniques, form_tips, is_favourite, times_sharp, created_at)
VALUES ('combo-w10', 'Jab → Cross → Rear Knee', 'weapons', 'weapons', 1, 0, 'boxing,knees',
  'Box your way into clinch range, then drive the knee up and through with the hip. The knee travels up and forward — hip drives it, not just the leg lifting.',
  0, 0, strftime('%s', 'now'));

INSERT OR IGNORE INTO combos (id, text, tier, level, unlocked, mastery_score, techniques, form_tips, is_favourite, times_sharp, created_at)
VALUES ('combo-w11', 'Teep → Step In → Rear Knee', 'weapons', 'weapons', 1, 0, 'defensive,knees',
  'Teep to reset the distance, then close the gap immediately and drive the knee. Two tools, two ranges — the teep sets up the knee.',
  0, 0, strftime('%s', 'now'));

-- ── Flow additions ────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO combos (id, text, tier, level, unlocked, mastery_score, techniques, form_tips, is_favourite, times_sharp, created_at)
VALUES ('combo-fl07', 'Switch Kick → Jab → Cross → Rear Roundhouse', 'flow', 'flow', 0, 0, 'boxing,kicks',
  'Switch kick opens the line and sets your range, hands close the distance, rear roundhouse finishes the combination. Stay on the balls of your feet throughout.',
  0, 0, strftime('%s', 'now'));

INSERT OR IGNORE INTO combos (id, text, tier, level, unlocked, mastery_score, techniques, form_tips, is_favourite, times_sharp, created_at)
VALUES ('combo-fl08', 'Rear Knee × 2 → Step Out → Jab → Cross', 'flow', 'flow', 1, 0, 'boxing,knees',
  'Two knees drive the tempo and wear down the body, step back out to punching range, finish with the hands. Control the rhythm between close and long range.',
  0, 0, strftime('%s', 'now'));

-- ── Deception additions ───────────────────────────────────────────────────────

INSERT OR IGNORE INTO combos (id, text, tier, level, unlocked, mastery_score, techniques, form_tips, is_favourite, times_sharp, created_at)
VALUES ('combo-d08', 'Feint Teep → Step In → Rear Knee → Jab → Cross', 'deception', 'deception', 1, 0, 'boxing,defensive,knees',
  'The feint teep freezes their footwork and draws a reaction. Step in immediately on the hesitation and drive the knee, then exit with the hands. Sell the feint.',
  0, 0, strftime('%s', 'now'));

INSERT OR IGNORE INTO combos (id, text, tier, level, unlocked, mastery_score, techniques, form_tips, is_favourite, times_sharp, created_at)
VALUES ('combo-d09', 'Cross → Step In → Lead Horizontal Elbow', 'deception', 'deception', 1, 0, 'boxing,elbows',
  'Drive the cross to close the distance, step in tight behind it, and turn the horizontal elbow through at clinch range. Arm parallel to the floor, forearm drives through the target.',
  0, 0, strftime('%s', 'now'));

-- ── Mastery additions ─────────────────────────────────────────────────────────

INSERT OR IGNORE INTO combos (id, text, tier, level, unlocked, mastery_score, techniques, form_tips, is_favourite, times_sharp, created_at)
VALUES ('combo-m06', 'Jab → Cross → Lead Diagonal Elbow → Reset', 'mastery', 'mastery', 1, 0, 'boxing,elbows',
  'Close the distance on the cross, transition to elbow range, and drive the diagonal elbow downward through the guard. Exit clean — the reset is part of the combo.',
  0, 0, strftime('%s', 'now'));

INSERT OR IGNORE INTO combos (id, text, tier, level, unlocked, mastery_score, techniques, form_tips, is_favourite, times_sharp, created_at)
VALUES ('combo-m07', 'Jab → Cross → Hook → Lead Elbow → Rear Knee → Reset', 'mastery', 'mastery', 1, 0, 'boxing,elbows,knees',
  'Five-stage sequence at three ranges. Punch to close, elbow at clinch range, knee to finish, exit clean. Economy of motion — no wasted movement between transitions.',
  0, 0, strftime('%s', 'now'));
