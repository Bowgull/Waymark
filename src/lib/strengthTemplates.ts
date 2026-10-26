import { LEAD_IN_TARGET, defaultMainLift, getStrengthWeekTarget, mainLiftHardSets, type StrengthWeekTarget } from './blockZero/strength'
import { strengthDayFor } from './blockZero/weekPlan'

export interface TemplateSet {
  isWarmup: boolean
  targetReps: number // 0 = max reps
  restSec: number
  suggestedWeightKg?: number | null
  /** Load relative to the week's working load (Block Zero check set). Default 1. */
  loadMultiplier?: number
}

export type ExerciseSection = 'warmup' | 'main' | 'accessory' | 'core'

export interface TemplateExercise {
  exerciseId: string
  label: string
  section: ExerciseSection
  sets: TemplateSet[]
  notes?: string
  /** False: no warm-up ramp before it (a landmine or bodyweight main lift: its first set is its warm-up). */
  ramp?: boolean
}

export interface StrengthTemplate {
  id: 'strength_a' | 'strength_b' | 'strength_c'
  label: string
  exercises: TemplateExercise[]
}

function warmupSets(count: number, reps: number): TemplateSet[] {
  return Array.from({ length: count }, () => ({ isWarmup: true, targetReps: reps, restSec: 30 }))
}

function workingSets(count: number, reps: number, restSec: number): TemplateSet[] {
  return Array.from({ length: count }, () => ({ isWarmup: false, targetReps: reps, restSec }))
}

/** Core and durability moves in a circuit (rebuild Phase 4): a short rest, the other side is the rest. */
function durabilitySets(count: number, reps: number): TemplateSet[] {
  return Array.from({ length: count }, () => ({ isWarmup: false, targetReps: reps, restSec: 30 }))
}

function coreSets(count: number, reps: number): TemplateSet[] {
  return Array.from({ length: count }, () => ({ isWarmup: false, targetReps: reps, restSec: 45 }))
}

// ─── Wave Loading (Fighter template) ─────────────────────────

/** Get loading percentage for a given block week and block type. */
export function getWeekPercentage(blockWeek: number, blockType: 'fighter' | 'block_zero' = 'fighter'): number {
  if (blockType === 'block_zero') {
    // Anchor for the RPE targets until per-set RPE exists. Extension weeks
    // hold week 5; nothing wraps back to week 1.
    return getStrengthWeekTarget(blockWeek).loadPct
  }
  const w = ((blockWeek - 1) % 6) + 1
  if (w === 1 || w === 4) return 0.75
  if (w === 2 || w === 5) return 0.80
  return 0.90 // w === 3 || w === 6
}

/** Get sets × reps for main lifts based on block week and block type. */
export function getWaveLoadingSetsReps(blockWeek: number, blockType: 'fighter' | 'block_zero' = 'fighter'): { sets: number; reps: number } {
  if (blockType === 'block_zero') {
    const t = getStrengthWeekTarget(blockWeek)
    return { sets: mainLiftHardSets(t), reps: t.reps }
  }
  const pct = getWeekPercentage(blockWeek)
  if (pct === 0.90) return { sets: 3, reps: 3 }
  return { sets: 3, reps: 5 }
}

/** Get week label for display in Program page. */
export function getWeekLabel(blockWeek: number, blockType: 'fighter' | 'block_zero' = 'fighter'): string {
  const pct = Math.round(getWeekPercentage(blockWeek, blockType) * 100)
  const { sets, reps } = getWaveLoadingSetsReps(blockWeek, blockType)
  if (blockType === 'block_zero') {
    // The week's working sets of 8 (a check set of 3-5 is not one of them: week 6 is 1×8).
    const t = getStrengthWeekTarget(blockWeek)
    return `Block Zero · ${t.mainSets}×${t.reps}, RPE ${t.rpe[0] === t.rpe[1] ? t.rpe[0] : `${t.rpe[0]}-${t.rpe[1]}`}`
  }
  return `${pct}%, ${sets}×${reps}`
}

// ─── Deadlift Phasing ─────────────────────────────────────────

/** Get the correct deadlift variant for the current block week. */
export function getDeadliftExerciseId(blockWeek: number): string {
  const w = ((blockWeek - 1) % 6) + 1
  if (w <= 2) return 'ex-rdl'
  if (w <= 4) return 'ex-block-pull'
  return 'ex-deadlift'
}

function getDeadliftLabel(blockWeek: number): string {
  const w = ((blockWeek - 1) % 6) + 1
  if (w <= 2) return 'Romanian Deadlift'
  if (w <= 4) return 'Block Pull'
  return 'Conventional Deadlift'
}

// ─── Fighter Templates ────────────────────────────────────────

function buildStrengthA(blockWeek: number): StrengthTemplate {
  const { sets, reps } = getWaveLoadingSetsReps(blockWeek)
  return {
    id: 'strength_a',
    label: 'Strength: Push',
    exercises: [
      // Warmup
      { exerciseId: 'ex-face-pulls', label: 'Face Pulls', section: 'warmup', sets: warmupSets(2, 15) },
      { exerciseId: 'ex-band-pull-aparts', label: 'Band Pull-Aparts', section: 'warmup', sets: warmupSets(2, 15) },
      // Main lifts (wave loaded)
      { exerciseId: 'ex-front-squat', label: 'Front Squat', section: 'main', sets: workingSets(sets, reps, 180) },
      { exerciseId: 'ex-bench-press', label: 'Bench Press', section: 'main', sets: workingSets(sets, reps, 180) },
      { exerciseId: 'ex-bent-over-row', label: 'Bent Over Row', section: 'main', sets: workingSets(sets, reps, 180) },
      // Accessories
      { exerciseId: 'ex-incline-db-press', label: 'Incline DB Press', section: 'accessory', sets: workingSets(3, 10, 120) },
      { exerciseId: 'ex-face-pulls', label: 'Face Pulls', section: 'accessory', sets: workingSets(3, 15, 60) },
      { exerciseId: 'ex-lateral-raise', label: 'Lateral Raise', section: 'accessory', sets: workingSets(3, 12, 60) },
      { exerciseId: 'ex-ez-curl', label: 'EZ Bar Curl', section: 'accessory', sets: workingSets(3, 10, 60) },
      // Core Circuit A
      { exerciseId: 'ex-ab-wheel', label: 'Ab Wheel Roll-Out', section: 'core', sets: coreSets(3, 10) },
      { exerciseId: 'ex-hanging-leg-raise', label: 'Hanging Leg Raises', section: 'core', sets: coreSets(3, 10) },
      { exerciseId: 'ex-pallof-press', label: 'Pallof Press', section: 'core', sets: coreSets(3, 12), notes: '12 each side' },
      { exerciseId: 'ex-side-plank-lift', label: 'Side Plank Hip Lift', section: 'core', sets: coreSets(3, 8), notes: '8 each side' },
    ],
  }
}

function buildStrengthB(blockWeek: number): StrengthTemplate {
  const { sets, reps } = getWaveLoadingSetsReps(blockWeek)
  const dlId = getDeadliftExerciseId(blockWeek)
  const dlLabel = getDeadliftLabel(blockWeek)
  return {
    id: 'strength_b',
    label: 'Strength: Pull',
    exercises: [
      // Warmup
      { exerciseId: 'ex-face-pulls', label: 'Face Pulls', section: 'warmup', sets: warmupSets(2, 15) },
      { exerciseId: 'ex-band-pull-aparts', label: 'Band Pull-Aparts', section: 'warmup', sets: warmupSets(2, 15) },
      // Main lifts (wave loaded)
      { exerciseId: dlId, label: dlLabel, section: 'main', sets: workingSets(sets, reps, 180) },
      { exerciseId: 'ex-ohp', label: 'Overhead Press', section: 'main', sets: workingSets(sets, reps, 180) },
      { exerciseId: 'ex-pullup-band', label: 'Pull-Up Progression', section: 'main', sets: workingSets(3, 0, 120), notes: 'Band, then Negatives, then Full. Log what you can do.' },
      // Accessories
      { exerciseId: 'ex-bulgarian-split-squat', label: 'Bulgarian Split Squat', section: 'accessory', sets: workingSets(3, 10, 90), notes: '10 each leg' },
      { exerciseId: 'ex-db-row', label: 'Dumbbell Row', section: 'accessory', sets: workingSets(3, 10, 90), notes: '10 each arm' },
      { exerciseId: 'ex-tricep-pushdown', label: 'Tricep Pushdown', section: 'accessory', sets: workingSets(3, 12, 60) },
      { exerciseId: 'ex-hammer-curl', label: 'Hammer Curl', section: 'accessory', sets: workingSets(3, 10, 60) },
      // Core Circuit B
      { exerciseId: 'ex-body-saw', label: 'Body Saw', section: 'core', sets: coreSets(3, 10) },
      { exerciseId: 'ex-cable-woodchop', label: 'Cable Woodchop', section: 'core', sets: coreSets(3, 10), notes: '10 each side' },
      { exerciseId: 'ex-weighted-dead-bug', label: 'Weighted Dead Bug', section: 'core', sets: coreSets(3, 10), notes: '10 each side' },
      { exerciseId: 'ex-suitcase-carry', label: 'Suitcase Carry', section: 'core', sets: coreSets(3, 30), notes: '30s each hand' },
    ],
  }
}

// ─── Block Zero Templates ─────────────────────────────────────

/**
 * Main-lift sets for a Block Zero week: an optional 3-5 rep check set at
 * ~RPE 8 first (weeks 3 and 6, R4), then the working sets of 8. Never to
 * failure. The RPE target rides in the exercise notes.
 */
function blockZeroMainSets(t: StrengthWeekTarget): TemplateSet[] {
  const sets: TemplateSet[] = []
  if (t.checkSet) {
    sets.push({ isWarmup: false, targetReps: t.checkSet.targetReps, restSec: 180, loadMultiplier: t.checkSet.loadMultiplier })
  }
  return sets.concat(workingSets(t.mainSets, t.reps, 150))
}

function mainNote(cue: string | null, t: StrengthWeekTarget): string {
  return cue ? `${cue} ${t.note}` : t.note
}

// Durability twice a week (A and C), exercises from migration 0026.
// R14: 4-way neck isometrics for robustness and clinch loading, not
// concussion claims. R13: wrist flexors and extensors for load tolerance;
// calf raises (A) and tibialis raises (C) for the lower leg. Grip carry on C.
function durability(t: StrengthWeekTarget, day: 'A' | 'C'): TemplateExercise[] {
  const sets = t.phase === 'consolidate' ? 1 : 2
  const out: TemplateExercise[] = [
    { exerciseId: 'ex-neck-iso-4way', label: 'Neck: 4-Way Isometric', section: 'core', sets: coreSets(sets, 4), notes: 'Durability. Front, back, left, right. Hold each 10-20s against your hand. Easy effort, nothing moves.' },
    { exerciseId: 'ex-wrist-curl', label: 'Wrist Curl', section: 'core', sets: coreSets(sets, 15), notes: 'Durability. Light. Slow lower to the fingertips.' },
    { exerciseId: 'ex-reverse-wrist-curl', label: 'Reverse Wrist Curl', section: 'core', sets: coreSets(sets, 15), notes: 'Durability. Lighter than the curl. Slow lower.' },
  ]
  if (day === 'A') {
    out.push({ exerciseId: 'ex-single-leg-calf-raise', label: 'Single-Leg Calf Raise', section: 'core', sets: coreSets(sets, 12), notes: 'Durability. 12 each leg. Full range, 2-3s down.' })
  } else {
    out.push(
      { exerciseId: 'ex-tibialis-raise', label: 'Tibialis Raise', section: 'core', sets: coreSets(sets, 15), notes: 'Durability. Toes up high, lower slowly.' },
      { exerciseId: 'ex-suitcase-carry', label: 'Grip: Suitcase Carry', section: 'core', sets: coreSets(sets, 30), notes: 'Durability. 30s each hand. Stand tall, no lean.' },
    )
  }
  return out
}

/**
 * Strength A (page 93, approved 2026-10-25): squat, the press the coach
 * picks (landmine first while the shoulders and back rebuild, overhead once
 * they're solid), the dumbbell row (bent-over once earned). A light landmine
 * RDL in the warm-up is the week's second hinge. Core, calves and the
 * Copenhagen plank, then the 10-minute fighter arm block: chin-ups on the
 * built ladder (reps only), hammer curls, grip. About 50 minutes.
 */
function buildBlockZeroStrengthA(blockWeek: number, intro = false): StrengthTemplate {
  const squat = defaultMainLift('squat', blockWeek)
  const row = defaultMainLift('row', blockWeek)
  const exercises: TemplateExercise[] = [
    { exerciseId: 'ex-band-pull-aparts', label: 'Band Pull-Aparts', section: 'warmup', sets: warmupSets(1, 15) },
    { exerciseId: 'ex-lm-rdl', label: 'Landmine RDL', section: 'warmup', sets: warmupSets(2, 8), notes: 'Light hinge: the bar only, slow. Hips back, shins still.' },
    { exerciseId: squat.exerciseId, label: squat.label, section: 'main', sets: workingSets(3, 8, 90), notes: 'Brace before each rep. Sit between the hips, chest up.' },
    { exerciseId: 'ex-landmine-press', label: 'Landmine Press', section: 'main', sets: workingSets(3, 8, 60), ramp: false },
    { exerciseId: row.exerciseId, label: row.label, section: 'main', sets: workingSets(3, 10, 60), notes: 'Flat back, pull to the lower ribs. Each arm.' },
  ]
  // The lead-in intro: the lifts only (Part B).
  if (intro) return { id: 'strength_a', label: 'Block Zero: A', exercises }
  exercises.push(
    { exerciseId: 'ex-dead-bugs', label: 'Dead Bugs', section: 'core', sets: durabilitySets(2, 10), notes: '10 each side. Back stays flat.' },
    { exerciseId: 'ex-side-plank', label: 'Side Plank', section: 'core', sets: durabilitySets(2, 30), notes: '30s each side.' },
    { exerciseId: 'ex-single-leg-calf-raise', label: 'Single-Leg Calf Raise', section: 'core', sets: durabilitySets(2, 12), notes: '12 each leg. Full range, 2-3s down.' },
    { exerciseId: 'ex-copenhagen-plank', label: 'Copenhagen Plank', section: 'core', sets: durabilitySets(2, 20), notes: 'Seconds each side. Knee on the bench to start.' },
    ...armBlock('A'),
  )
  return { id: 'strength_a', label: 'Block Zero: A', exercises }
}

/**
 * Strength B (page 93): the power block first (the landmine punch: slow and
 * crisp, fast later; the normal reps-left card), the hinge (DB RDL, then the
 * block pull or trap bar), the bench, the landmine reverse lunge (the week's
 * second squat-pattern). The Nordic and the bent-knee calf raise (the tibialis
 * raise made room for the row), then the arm block: the dumbbell row (pulling
 * twice a week, 2026-10-26), dips (or the close-grip press), wrist curls.
 */
function buildBlockZeroStrengthB(blockWeek: number, intro = false): StrengthTemplate {
  const hinge = defaultMainLift('hinge', blockWeek)
  const exercises: TemplateExercise[] = [
    { exerciseId: 'ex-glute-bridges', label: 'Glute Bridges', section: 'warmup', sets: warmupSets(2, 12), notes: 'Squeeze at the top. Ribs down.' },
    { exerciseId: 'ex-lm-punch', label: 'Landmine Punch', section: 'main', sets: workingSets(3, 4, 60), ramp: false },
    { exerciseId: hinge.exerciseId, label: hinge.label, section: 'main', sets: workingSets(3, 8, 90), notes: 'Hips back, spine long. Feel the hamstrings, not the lower back.' },
    { exerciseId: 'ex-bench-press', label: 'Bench Press', section: 'main', sets: workingSets(3, 8, 90) },
    { exerciseId: 'ex-lm-reverse-lunge', label: 'Landmine Reverse Lunge', section: 'main', sets: workingSets(3, 8, 45), ramp: false },
  ]
  if (intro) return { id: 'strength_b', label: 'Block Zero: B', exercises }
  exercises.push(
    { exerciseId: 'ex-nordic-curl', label: 'Nordic Curl', section: 'core', sets: durabilitySets(2, 3), notes: 'As slow as you can control. Hands catch you.' },
    { exerciseId: 'ex-bent-knee-calf-raise', label: 'Bent-Knee Calf Raise', section: 'core', sets: durabilitySets(2, 12), notes: 'Knees bent, full range, 2-3s down.' },
    ...armBlock('B'),
  )
  return { id: 'strength_b', label: 'Block Zero: B', exercises }
}

/**
 * The 10-minute fighter arm block at the end of each lift (page 93; it
 * replaces the isolation arm work). Chin-ups once a week, on Strength A only,
 * reps only on the built ladder (band, slow lowering, full: the dose picks
 * the rung). Strength B: the supported dumbbell row (the week's second pull;
 * hand and knee on the bench spares the low back on the hinge day), then dips,
 * or the close-grip press when the shoulders say so. Hammer curls on A (B's
 * row works the same arms); grip on A, wrist curls on B. B's row has its own
 * weights as an arm-block move, apart from A's main row.
 */
export function armBlock(day: 'A' | 'B'): TemplateExercise[] {
  const curls: TemplateExercise = { exerciseId: 'ex-hammer-curl', label: 'Hammer Curl', section: 'accessory', sets: workingSets(2, 10, 30) }
  if (day === 'A') {
    return [
      { exerciseId: 'ex-chin-up-band', label: 'Chin-Up (Band)', section: 'accessory', sets: workingSets(3, 5, 45), notes: 'Reps only. Full hang at the bottom.' },
      curls,
      { exerciseId: 'ex-suitcase-carry', label: 'Grip: Suitcase Carry', section: 'accessory', sets: workingSets(2, 30, 30), notes: '30s each hand. Stand tall, no lean.' },
    ]
  }
  return [
    { exerciseId: 'ex-db-row', label: 'Dumbbell Row', section: 'accessory', sets: workingSets(3, 10, 45), notes: 'Hand and knee on the bench, flat back, pull to the hip. Each arm.' },
    { exerciseId: 'ex-dips', label: 'Dips', section: 'accessory', sets: workingSets(3, 6, 45), notes: 'Reps only. Stop short if the shoulder pinches.' },
    { exerciseId: 'ex-wrist-curl', label: 'Wrist Curl', section: 'accessory', sets: workingSets(2, 15, 30), notes: 'Light. Slow lower to the fingertips.' },
  ]
}

/**
 * Block Zero C (Fri): row + single-leg work. Supported DB row in weeks 1-2,
 * bent-over row from week 3. Durability finisher.
 */
function buildBlockZeroStrengthC(blockWeek: number, intro = false): StrengthTemplate {
  const t = intro ? LEAD_IN_TARGET : getStrengthWeekTarget(blockWeek)
  const row = defaultMainLift('row', blockWeek)
  const exercises: TemplateExercise[] = [
    { exerciseId: 'ex-glute-bridges', label: 'Glute Bridges', section: 'warmup', sets: warmupSets(2, 12), notes: 'Squeeze at the top. Ribs down.' },
    { exerciseId: 'ex-band-pull-aparts', label: 'Band Pull-Aparts', section: 'warmup', sets: warmupSets(2, 15) },
    { exerciseId: row.exerciseId, label: row.label, section: 'main', sets: blockZeroMainSets(t), notes: mainNote('Flat back, pull to the lower ribs.', t) },
    { exerciseId: 'ex-reverse-lunge', label: 'Reverse Lunge', section: 'main', sets: blockZeroMainSets(t), notes: mainNote('Each leg. Step back, front knee over the foot.', t) },
    { exerciseId: 'ex-incline-db-press', label: 'Incline DB Press', section: 'accessory', sets: workingSets(t.accessorySets, 10, 75) },
    { exerciseId: 'ex-lateral-raise', label: 'Lateral Raise', section: 'accessory', sets: workingSets(t.accessorySets, 12, 60) },
    { exerciseId: 'ex-pallof-press', label: 'Pallof Press', section: 'core', sets: coreSets(t.coreSets, 10), notes: '10 each side.' },
    ...(intro ? [] : durability(t, 'C')),
  ]
  return { id: 'strength_c', label: 'Block Zero: C', exercises }
}

// ─── Template Selector ────────────────────────────────────────

/**
 * Pick the correct template based on day of week, block week, and block type.
 * Block Zero has three days (A/B/C); the session label ("Strength B") wins over
 * the day so a moved session keeps its content.
 */
export function getStrengthTemplate(
  dayOfWeek: number,
  blockWeek: number = 1,
  blockType: 'fighter' | 'block_zero' = 'fighter',
  label?: string | null,
  opts: { leadIn?: boolean } = {},
): StrengthTemplate {
  if (blockType === 'block_zero') {
    // Lead-in: the intro session, week-1 lifts at RPE 5-6 (Part B).
    const intro = opts.leadIn === true
    const day = strengthDayFor(dayOfWeek, label)
    if (day === 'A') return buildBlockZeroStrengthA(intro ? 1 : blockWeek, intro)
    if (day === 'B') return buildBlockZeroStrengthB(intro ? 1 : blockWeek, intro)
    return buildBlockZeroStrengthC(intro ? 1 : blockWeek, intro)
  }
  return dayOfWeek === 2 ? buildStrengthA(blockWeek) : buildStrengthB(blockWeek)
}
