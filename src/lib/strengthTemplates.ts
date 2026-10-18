import { defaultMainLift, getStrengthWeekTarget, mainLiftHardSets, type StrengthWeekTarget } from './blockZero/strength'
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
    const t = getStrengthWeekTarget(blockWeek)
    return `Block Zero · ${sets}×${reps}, RPE ${t.rpe[0] === t.rpe[1] ? t.rpe[0] : `${t.rpe[0]}-${t.rpe[1]}`}`
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

// Durability twice a week (A and C). R14: neck work for robustness, not
// concussion claims. Chin tucks stand in for neck isometrics, hammer curls and
// carries for wrist and grip, until dedicated exercises exist.
function durability(t: StrengthWeekTarget): TemplateExercise[] {
  const sets = t.phase === 'consolidate' ? 1 : 2
  return [
    { exerciseId: 'ex-chin-tucks', label: 'Neck: Chin Tucks', section: 'core', sets: coreSets(sets, 10), notes: 'Durability. Hold each rep 5s. Add light hand pressure for an isometric. Easy effort.' },
    { exerciseId: 'ex-hammer-curl', label: 'Wrist: Hammer Curl', section: 'core', sets: coreSets(sets, 12), notes: 'Durability. Slow lower. Wrist stays neutral.' },
    { exerciseId: 'ex-suitcase-carry', label: 'Grip: Suitcase Carry', section: 'core', sets: coreSets(sets, 30), notes: 'Durability. 30s each hand. Stand tall, no lean.' },
  ]
}

/**
 * Block Zero A (Mon): squat pattern + bench. Goblet squat in weeks 1-2, front
 * squat from week 3 (back-friendly first). Durability finisher.
 */
function buildBlockZeroStrengthA(blockWeek: number): StrengthTemplate {
  const t = getStrengthWeekTarget(blockWeek)
  const squat = defaultMainLift('squat', blockWeek)
  const exercises: TemplateExercise[] = [
    { exerciseId: 'ex-glute-bridges', label: 'Glute Bridges', section: 'warmup', sets: warmupSets(2, 12), notes: 'Squeeze at the top. Ribs down.' },
    { exerciseId: 'ex-band-pull-aparts', label: 'Band Pull-Aparts', section: 'warmup', sets: warmupSets(2, 15) },
    { exerciseId: squat.exerciseId, label: squat.label, section: 'main', sets: blockZeroMainSets(t), notes: mainNote('Brace before each rep. Sit between the hips, chest up.', t) },
    { exerciseId: 'ex-bench-press', label: 'Bench Press', section: 'main', sets: blockZeroMainSets(t), notes: mainNote(null, t) },
    { exerciseId: 'ex-db-row', label: 'Dumbbell Row', section: 'accessory', sets: workingSets(t.accessorySets, 10, 75), notes: '10 each arm. Supported on the bench.' },
    { exerciseId: 'ex-face-pulls', label: 'Face Pulls', section: 'accessory', sets: workingSets(t.accessorySets, 15, 60) },
    { exerciseId: 'ex-dead-bugs', label: 'Dead Bugs', section: 'core', sets: coreSets(t.coreSets, 10), notes: '10 each side. Back stays flat.' },
  ]
  if (t.phase === 'test' || t.phase === 'consolidate') {
    exercises.push({ exerciseId: 'ex-push-up', label: 'Push-Up Test', section: 'core', sets: coreSets(1, 0), notes: 'Test. One set of clean push-ups, stop when form breaks. Log the reps.' })
  }
  exercises.push(...durability(t))
  return { id: 'strength_a', label: 'Block Zero: A', exercises }
}

/**
 * Block Zero B (Wed): hinge + overhead press. DB RDL in weeks 1-2, block pull
 * from week 3. Hinge at the hips, never round to reach the floor.
 */
function buildBlockZeroStrengthB(blockWeek: number): StrengthTemplate {
  const t = getStrengthWeekTarget(blockWeek)
  const hinge = defaultMainLift('hinge', blockWeek)
  const isTest = t.phase === 'test' || t.phase === 'consolidate'
  const exercises: TemplateExercise[] = [
    { exerciseId: 'ex-glute-bridges', label: 'Glute Bridges', section: 'warmup', sets: warmupSets(2, 12), notes: 'Squeeze at the top. Ribs down.' },
    { exerciseId: 'ex-face-pulls', label: 'Face Pulls', section: 'warmup', sets: warmupSets(2, 15) },
    { exerciseId: hinge.exerciseId, label: hinge.label, section: 'main', sets: blockZeroMainSets(t), notes: mainNote('Hips back, spine long. Feel the hamstrings, not the lower back.', t) },
    { exerciseId: 'ex-ohp', label: 'Overhead Press', section: 'main', sets: blockZeroMainSets(t), notes: mainNote('Squeeze glutes, ribs down. No lean back.', t) },
    { exerciseId: 'ex-lat-pulldown', label: 'Lat Pulldown', section: 'accessory', sets: workingSets(t.accessorySets, 10, 75) },
    { exerciseId: 'ex-hamstring-curl', label: 'Hamstring Curl', section: 'accessory', sets: workingSets(t.accessorySets, 10, 60) },
    { exerciseId: 'ex-bird-dogs', label: 'Bird Dogs', section: 'core', sets: coreSets(t.coreSets, 10), notes: '10 each side. Hold 2s at reach.' },
    {
      exerciseId: 'ex-side-plank-lift', label: 'Side Plank Hip Lift', section: 'core', sets: coreSets(t.coreSets, 8),
      notes: isTest ? 'Test. Side plank hold each side. Log the seconds in notes.' : '8 each side.',
    },
  ]
  return { id: 'strength_b', label: 'Block Zero: B', exercises }
}

/**
 * Block Zero C (Fri): row + single-leg work. Supported DB row in weeks 1-2,
 * bent-over row from week 3. Durability finisher.
 */
function buildBlockZeroStrengthC(blockWeek: number): StrengthTemplate {
  const t = getStrengthWeekTarget(blockWeek)
  const row = defaultMainLift('row', blockWeek)
  const exercises: TemplateExercise[] = [
    { exerciseId: 'ex-glute-bridges', label: 'Glute Bridges', section: 'warmup', sets: warmupSets(2, 12), notes: 'Squeeze at the top. Ribs down.' },
    { exerciseId: 'ex-band-pull-aparts', label: 'Band Pull-Aparts', section: 'warmup', sets: warmupSets(2, 15) },
    { exerciseId: row.exerciseId, label: row.label, section: 'main', sets: blockZeroMainSets(t), notes: mainNote('Flat back, pull to the lower ribs.', t) },
    { exerciseId: 'ex-reverse-lunge', label: 'Reverse Lunge', section: 'main', sets: blockZeroMainSets(t), notes: mainNote('Each leg. Step back, front knee over the foot.', t) },
    { exerciseId: 'ex-incline-db-press', label: 'Incline DB Press', section: 'accessory', sets: workingSets(t.accessorySets, 10, 75) },
    { exerciseId: 'ex-lateral-raise', label: 'Lateral Raise', section: 'accessory', sets: workingSets(t.accessorySets, 12, 60) },
    { exerciseId: 'ex-pallof-press', label: 'Pallof Press', section: 'core', sets: coreSets(t.coreSets, 10), notes: '10 each side.' },
    ...durability(t),
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
): StrengthTemplate {
  if (blockType === 'block_zero') {
    const day = strengthDayFor(dayOfWeek, label)
    if (day === 'A') return buildBlockZeroStrengthA(blockWeek)
    if (day === 'B') return buildBlockZeroStrengthB(blockWeek)
    return buildBlockZeroStrengthC(blockWeek)
  }
  return dayOfWeek === 2 ? buildStrengthA(blockWeek) : buildStrengthB(blockWeek)
}
