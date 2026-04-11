/**
 * Seed script for Waymark local D1 database.
 *
 * Usage: npx wrangler d1 execute waymark-db --local --file=./src/db/seed.sql
 *
 * This file generates seed.sql — run `npx tsx src/db/seed.ts` to produce it,
 * then execute the SQL against D1.
 *
 * Alternatively, this exports the raw data arrays for use in API seed endpoints.
 */

import { writeFileSync } from 'fs'

const now = Math.floor(Date.now() / 1000)

// ─── Exercises ─────────────────────────────────────────────────

interface Exercise {
  id: string
  name: string
  category: string
  muscleGroups: string
  equipment: string
  formCues: string
}

const exercises: Exercise[] = [
  // Strength
  {
    id: 'ex-front-squat',
    name: 'Front Squat',
    category: 'strength',
    muscleGroups: 'quads,glutes,core',
    equipment: 'barbell',
    formCues: 'Elbows high, chest up. Bar rests on front delts, not wrists. Knees track over toes. Go to parallel or below. Keep torso upright — this is great for posture.',
  },
  {
    id: 'ex-landmine-press',
    name: 'Landmine Press',
    category: 'strength',
    muscleGroups: 'shoulders,triceps,core',
    equipment: 'barbell',
    formCues: 'One hand on end of barbell in landmine. Stagger stance. Press up and slightly forward. Engages core heavily. Shoulder-friendly alternative to OHP for forward-head posture.',
  },
  {
    id: 'ex-ohp',
    name: 'Overhead Press',
    category: 'strength',
    muscleGroups: 'shoulders,triceps',
    equipment: 'barbell',
    formCues: 'Bar starts at collarbone. Press straight up, head moves through at top. Brace core hard. If you feel it in front of shoulders more than back, switch to landmine press.',
  },
  {
    id: 'ex-incline-db-press',
    name: 'Incline DB Press',
    category: 'strength',
    muscleGroups: 'chest,shoulders,triceps',
    equipment: 'dumbbell',
    formCues: 'Bench at 30-45 degrees. Retract shoulder blades, squeeze them together. Press up without letting shoulders roll forward. Better for posture than flat bench.',
  },
  {
    id: 'ex-bent-over-row',
    name: 'Bent Over Row',
    category: 'strength',
    muscleGroups: 'back,biceps,rear_delts',
    equipment: 'barbell',
    formCues: 'Hinge at hips, back flat. Pull bar to lower chest. Squeeze shoulder blades at top. Keep elbows close. Fights the forward-shoulder posture from desk work.',
  },
  {
    id: 'ex-pullup-band',
    name: 'Pull-Up (Band Assisted)',
    category: 'strength',
    muscleGroups: 'back,biceps,core',
    equipment: 'pull-up bar,band',
    formCues: 'Loop band over bar, place knee or foot in loop. Full dead hang at bottom, chin over bar at top. Focus on pulling with lats, not just arms. Build to unassisted.',
  },
  {
    id: 'ex-pullup-negative',
    name: 'Pull-Up (Negative)',
    category: 'strength',
    muscleGroups: 'back,biceps,core',
    equipment: 'pull-up bar',
    formCues: 'Jump to top position (chin over bar). Lower yourself as slowly as possible — aim for 5 seconds down. Full extension at bottom. This builds the strength for real pull-ups.',
  },
  {
    id: 'ex-pullup',
    name: 'Pull-Up',
    category: 'strength',
    muscleGroups: 'back,biceps,core',
    equipment: 'pull-up bar',
    formCues: 'Dead hang, shoulder-width grip. Pull until chin clears bar. Control the descent. Critical for MT clinch strength and countering desk posture.',
  },
  {
    id: 'ex-face-pulls',
    name: 'Face Pulls',
    category: 'strength',
    muscleGroups: 'rear_delts,rotator_cuff,traps',
    equipment: 'cable,band',
    formCues: 'Cable or band at face height. Pull to face, externally rotate hands at end (pinkies back). Squeeze shoulder blades. Non-negotiable for posture — do every strength day.',
  },
  {
    id: 'ex-band-pull-aparts',
    name: 'Band Pull-Aparts',
    category: 'strength',
    muscleGroups: 'rear_delts,rhomboids,traps',
    equipment: 'band',
    formCues: 'Hold band at arm\'s length, shoulder width. Pull apart until band touches chest. Squeeze shoulder blades together. 15-20 reps. Warmup staple for posture correction.',
  },
  // Core
  {
    id: 'ex-hanging-leg-raise',
    name: 'Hanging Leg Raise',
    category: 'core',
    muscleGroups: 'lower_abs,hip_flexors',
    equipment: 'pull-up bar',
    formCues: 'Dead hang. Raise legs to parallel or higher without swinging. Control the descent. If too hard, bend knees (hanging knee raise).',
  },
  {
    id: 'ex-ab-wheel',
    name: 'Ab Wheel Roll-Out',
    category: 'core',
    muscleGroups: 'abs,lats,shoulders',
    equipment: 'ab wheel',
    formCues: 'Kneel on pad. Roll out as far as you can control, then pull back. Keep lower back from sagging. Start with partial range if needed.',
  },
  {
    id: 'ex-v-ups',
    name: 'V-Ups',
    category: 'core',
    muscleGroups: 'abs',
    equipment: 'bodyweight',
    formCues: 'Lie flat. Simultaneously raise legs and torso to touch toes at the top. Control down. Keep legs as straight as possible.',
  },
  {
    id: 'ex-russian-twists',
    name: 'Russian Twists',
    category: 'core',
    muscleGroups: 'obliques,abs',
    equipment: 'bodyweight',
    formCues: 'Sit, lean back 45 degrees, feet off ground. Rotate side to side, touching floor each side. Add weight when ready. Important for rotational power in MT.',
  },
  {
    id: 'ex-side-plank-lift',
    name: 'Side Plank + Lift',
    category: 'core',
    muscleGroups: 'obliques,glutes',
    equipment: 'bodyweight',
    formCues: 'Side plank on elbow. Lift top leg. Hold 30s each side. Builds anti-rotation stability for strikes and clinch.',
  },
  // Posture correctives
  {
    id: 'ex-doorway-pec-stretch',
    name: 'Doorway Pec Stretch',
    category: 'posture',
    muscleGroups: 'chest,front_delts',
    equipment: 'doorway',
    formCues: 'Forearm on doorframe at 90 degrees. Step through gently. Hold 30-45s each side. Opens the chest that gets tight from desk posture. Do daily.',
  },
  {
    id: 'ex-foam-roller-thoracic',
    name: 'Foam Roller Thoracic Extensions',
    category: 'posture',
    muscleGroups: 'thoracic_spine,upper_back',
    equipment: 'foam roller',
    formCues: 'Lie on foam roller at mid-back. Hands behind head. Extend backward over roller. Move roller up/down spine. Opens thoracic spine to fight rounded upper back.',
  },
  {
    id: 'ex-cat-cow',
    name: 'Cat-Cow',
    category: 'posture',
    muscleGroups: 'spine,core',
    equipment: 'bodyweight',
    formCues: 'On all fours. Arch back up (cat), then drop belly and look up (cow). Move slowly with breath. Warms up entire spine and teaches segmental movement.',
  },
  {
    id: 'ex-chin-tucks',
    name: 'Chin Tucks',
    category: 'posture',
    muscleGroups: 'deep_neck_flexors',
    equipment: 'bodyweight',
    formCues: 'Sitting or standing tall. Pull chin straight back (make a double chin). Hold 5-10s. Strengthens deep neck flexors that are weak from forward head posture. Do 10-15 reps.',
  },
  {
    id: 'ex-wall-slides',
    name: 'Wall Slides',
    category: 'posture',
    muscleGroups: 'serratus,lower_traps,rotator_cuff',
    equipment: 'wall',
    formCues: 'Back flat against wall. Arms up in goalpost position, back of hands on wall. Slide arms up and down keeping contact with wall. If you can\'t keep contact, that shows how tight you are.',
  },
  {
    id: 'ex-prone-y-raises',
    name: 'Prone Y Raises',
    category: 'posture',
    muscleGroups: 'lower_traps,rear_delts',
    equipment: 'bodyweight',
    formCues: 'Lie face down. Arms form a Y shape. Lift arms off ground, squeeze shoulder blades down and together. Hold 2-3s at top. Activates the muscles that pull shoulders back.',
  },
  // Mobility (hip)
  {
    id: 'ex-cossack-squats',
    name: 'Cossack Squats',
    category: 'mobility',
    muscleGroups: 'adductors,hips,ankles',
    equipment: 'bodyweight',
    formCues: 'Wide stance. Shift weight to one side, sinking deep. Other leg stays straight. Alternate sides. Deep hip stretch + stability. Great for MT kick flexibility.',
  },
  {
    id: 'ex-90-90-hip-switches',
    name: '90/90 Hip Switches',
    category: 'mobility',
    muscleGroups: 'hips,glutes',
    equipment: 'bodyweight',
    formCues: 'Sit on floor, both legs at 90 degrees. Rotate knees to switch sides without using hands. Smooth rotation, control the movement. Opens hip internal and external rotation.',
  },
  {
    id: 'ex-pigeon-stretch',
    name: 'Pigeon Stretch',
    category: 'mobility',
    muscleGroups: 'glutes,hip_flexors',
    equipment: 'bodyweight',
    formCues: 'Front leg bent 90 degrees in front. Back leg extended. Sink hips down and forward. Hold 45s each side. Deep glute and external rotation stretch.',
  },
  {
    id: 'ex-wall-hip-cars',
    name: 'Wall Hip CARs',
    category: 'mobility',
    muscleGroups: 'hips',
    equipment: 'wall',
    formCues: 'Face wall, hands on wall for balance. Lift knee high, rotate outward in largest circle possible, then reverse. Controlled articular rotation — builds usable hip range.',
  },
  {
    id: 'ex-wall-angels',
    name: 'Wall Angels',
    category: 'mobility',
    muscleGroups: 'thoracic_spine,shoulders',
    equipment: 'wall',
    formCues: 'Back against wall, arms in goalpost. Slide arms up overhead keeping back and arms on wall. If your lower back arches off, brace core harder. Thoracic mobility + shoulder health.',
  },
]

// ─── Combos (from XLSX) ────────────────────────────────────────

interface Combo {
  id: string
  text: string
  tier: string
  level: string
  unlocked: number
}

const combos: Combo[] = [
  // Power tier (simpler combos — unlocked by default for beginners)
  { id: 'combo-p01', text: 'Jab Only', tier: 'power', level: 'beginner', unlocked: 1 },
  { id: 'combo-p02', text: 'Jab → Cross → Left Kick', tier: 'power', level: 'beginner', unlocked: 1 },
  { id: 'combo-p03', text: 'Jab → Cross → Hook → Reset', tier: 'power', level: 'beginner', unlocked: 1 },
  { id: 'combo-p04', text: 'Jab → Cross → Switch Kick', tier: 'power', level: 'beginner', unlocked: 1 },
  { id: 'combo-p05', text: 'Jab → Cross → Hook → Cross', tier: 'power', level: 'beginner', unlocked: 1 },
  { id: 'combo-p06', text: 'Jab → Cross → Right Kick', tier: 'power', level: 'intermediate', unlocked: 0 },
  { id: 'combo-p07', text: 'Cross → Hook → Cross → Left Kick', tier: 'power', level: 'intermediate', unlocked: 0 },
  { id: 'combo-p08', text: 'Right Leg Kick → Jab → Cross → Left Leg Kick', tier: 'power', level: 'intermediate', unlocked: 0 },
  { id: 'combo-p09', text: 'Double Jab → Cross → Right Kick', tier: 'power', level: 'intermediate', unlocked: 0 },
  { id: 'combo-p10', text: 'Cross → Hook → Cross → Step Off', tier: 'power', level: 'intermediate', unlocked: 0 },
  { id: 'combo-p11', text: 'Jab → Cross → Hook → Low Kick', tier: 'power', level: 'intermediate', unlocked: 0 },

  // Long Skip tier (advanced combos with feints, checks, resets — all locked)
  { id: 'combo-ls01', text: 'Feint Jab → Cross → Left Kick → Step Out', tier: 'long_skip', level: 'intermediate', unlocked: 0 },
  { id: 'combo-ls02', text: 'Jab → Check → Cross → Hook → Right Kick', tier: 'long_skip', level: 'intermediate', unlocked: 0 },
  { id: 'combo-ls03', text: 'Jab → Feint Teep → Cross → Hook → Reset', tier: 'long_skip', level: 'intermediate', unlocked: 0 },
  { id: 'combo-ls04', text: 'Feint Low Kick → Cross → Hook → Left Body Kick', tier: 'long_skip', level: 'intermediate', unlocked: 0 },
  { id: 'combo-ls05', text: 'Teep → Step Back → Cross → Hook → Low Kick', tier: 'long_skip', level: 'intermediate', unlocked: 0 },
  { id: 'combo-ls06', text: 'Jab → Cross → Body Kick', tier: 'long_skip', level: 'intermediate', unlocked: 0 },
  { id: 'combo-ls07', text: 'Double Jab → Feint → Right Kick → Reset', tier: 'long_skip', level: 'advanced', unlocked: 0 },
  { id: 'combo-ls08', text: 'Jab → Cross → Hook → Check → Teep', tier: 'long_skip', level: 'advanced', unlocked: 0 },
  { id: 'combo-ls09', text: 'Jab → Cross → Feint → Low Kick → Exit', tier: 'long_skip', level: 'advanced', unlocked: 0 },
  { id: 'combo-ls10', text: 'Feint Teep → Cross → Hook → Cross → Reset', tier: 'long_skip', level: 'advanced', unlocked: 0 },
  { id: 'combo-ls11', text: 'Jab → Cross → Hook → Low Kick', tier: 'long_skip', level: 'advanced', unlocked: 0 },
]

// ─── Generate SQL ──────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/'/g, "''")
}

const lines: string[] = []

// Exercises
for (const e of exercises) {
  lines.push(
    `INSERT OR IGNORE INTO exercises (id, name, category, muscle_groups, equipment, form_cues, created_at) VALUES ('${e.id}', '${esc(e.name)}', '${e.category}', '${e.muscleGroups}', '${esc(e.equipment)}', '${esc(e.formCues)}', ${now});`
  )
}

// Combos
for (const c of combos) {
  lines.push(
    `INSERT OR IGNORE INTO combos (id, text, tier, level, unlocked, created_at) VALUES ('${c.id}', '${esc(c.text)}', '${c.tier}', '${c.level}', ${c.unlocked}, ${now});`
  )
}

// Default settings row
lines.push(
  `INSERT OR IGNORE INTO settings (id, mt_class_days, am_reminder, pm_lead_min, created_at, updated_at) VALUES ('default', '1,3,5', '06:30', 60, ${now}, ${now});`
)

const sql = lines.join('\n')
writeFileSync('src/db/seed.sql', sql)
console.log(`Wrote ${lines.length} statements to src/db/seed.sql`)
