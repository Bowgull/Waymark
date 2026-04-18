export interface TemplateSet {
  isWarmup: boolean
  targetReps: number // 0 = max reps
  restSec: number
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
  id: 'strength_a' | 'strength_b'
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
    // Linear ramp: 40% → 45% → 50% → 55% → 60% → 65%
    const ramp = [0.40, 0.45, 0.50, 0.55, 0.60, 0.65]
    const w = Math.min(Math.max(blockWeek - 1, 0), 5)
    return ramp[w]
  }
  const w = ((blockWeek - 1) % 6) + 1
  if (w === 1 || w === 4) return 0.75
  if (w === 2 || w === 5) return 0.80
  return 0.90 // w === 3 || w === 6
}

/** Get sets × reps for main lifts based on block week and block type. */
export function getWaveLoadingSetsReps(blockWeek: number, blockType: 'fighter' | 'block_zero' = 'fighter'): { sets: number; reps: number } {
  if (blockType === 'block_zero') {
    // Weeks 1-2: 2×5 — lower volume while connective tissue re-adapts
    // Weeks 3-6: 3×5 — building back to full working volume
    return blockWeek <= 2 ? { sets: 2, reps: 5 } : { sets: 3, reps: 5 }
  }
  const pct = getWeekPercentage(blockWeek)
  if (pct === 0.90) return { sets: 3, reps: 3 }
  return { sets: 3, reps: 5 }
}

/** Get week label for display in Program page. */
export function getWeekLabel(blockWeek: number, blockType: 'fighter' | 'block_zero' = 'fighter'): string {
  const pct = Math.round(getWeekPercentage(blockWeek, blockType) * 100)
  const { sets, reps } = getWaveLoadingSetsReps(blockWeek, blockType)
  if (blockType === 'block_zero') return `Block Zero · ${pct}%, ${sets}×${reps}`
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
 * Block Zero Strength A (Push day).
 *
 * Weeks 1-2: 2×5 main lifts only. No accessories or core — Foundation Run
 *   handles corrective volume. Connective tissue loads minimally.
 * Weeks 3-4: 3×5 main lifts + reduced accessory (2 sets). Core returns.
 * Weeks 5-6: Full Fighter-equivalent volume at 60-65% TM.
 *
 * RDL replaces Front Squat for all 6 weeks — hip flexor tightness from APT
 * makes the front squat bottom position high-risk until mobility improves.
 * Front squat returns in Block 1.
 */
function buildBlockZeroStrengthA(blockWeek: number): StrengthTemplate {
  const { sets, reps } = getWaveLoadingSetsReps(blockWeek, 'block_zero')
  const isEarlyPhase = blockWeek <= 2
  const isMidPhase = blockWeek <= 4

  const exercises: TemplateExercise[] = [
    // Glute activation warmup (APT corrective — activates inhibited glutes before loading)
    { exerciseId: 'ex-glute-bridges', label: 'Glute Bridges', section: 'warmup', sets: warmupSets(2, 15), notes: 'Squeeze at the top. Tuck tailbone. Activates glutes before squatting.' },
    { exerciseId: 'ex-face-pulls', label: 'Face Pulls', section: 'warmup', sets: warmupSets(2, 15) },
    { exerciseId: 'ex-band-pull-aparts', label: 'Band Pull-Aparts', section: 'warmup', sets: warmupSets(2, 15) },
    // Main lifts — RDL replaces front squat to protect APT-affected hips
    { exerciseId: 'ex-rdl', label: 'Romanian Deadlift', section: 'main', sets: workingSets(sets, reps, 150), notes: 'Hinge at hips, soft bend in knees. Feel the hamstring stretch, not the lower back.' },
    { exerciseId: 'ex-bench-press', label: 'Bench Press', section: 'main', sets: workingSets(sets, reps, 150) },
    { exerciseId: 'ex-bent-over-row', label: 'Bent Over Row', section: 'main', sets: workingSets(sets, reps, 150) },
  ]

  if (!isEarlyPhase) {
    // Weeks 3+: Add accessories (2 sets in mid, 3 in late)
    const accSets = isMidPhase ? 2 : 3
    exercises.push(
      { exerciseId: 'ex-incline-db-press', label: 'Incline DB Press', section: 'accessory', sets: workingSets(accSets, 10, 90) },
      { exerciseId: 'ex-face-pulls', label: 'Face Pulls', section: 'accessory', sets: workingSets(accSets, 15, 60) },
      { exerciseId: 'ex-lateral-raise', label: 'Lateral Raise', section: 'accessory', sets: workingSets(accSets, 12, 60) },
      // Core — APT-focused: dead bugs and Pallof press (no leg raises yet)
      { exerciseId: 'ex-dead-bugs', label: 'Dead Bugs', section: 'core', sets: coreSets(2, 10), notes: '10 each side. Back stays flat on the floor.' },
      { exerciseId: 'ex-pallof-press', label: 'Pallof Press', section: 'core', sets: coreSets(2, 10), notes: '10 each side.' },
    )
  }

  return { id: 'strength_a', label: 'Block Zero: Push', exercises }
}

/**
 * Block Zero Strength B (Pull day).
 * Same phase logic as A. RDL stays as the primary hinge pattern all 6 weeks.
 */
function buildBlockZeroStrengthB(blockWeek: number): StrengthTemplate {
  const { sets, reps } = getWaveLoadingSetsReps(blockWeek, 'block_zero')
  const isEarlyPhase = blockWeek <= 2
  const isMidPhase = blockWeek <= 4

  const exercises: TemplateExercise[] = [
    // Glute activation warmup
    { exerciseId: 'ex-glute-bridges', label: 'Glute Bridges', section: 'warmup', sets: warmupSets(2, 15), notes: 'Squeeze at the top. Tuck tailbone.' },
    { exerciseId: 'ex-face-pulls', label: 'Face Pulls', section: 'warmup', sets: warmupSets(2, 15) },
    { exerciseId: 'ex-band-pull-aparts', label: 'Band Pull-Aparts', section: 'warmup', sets: warmupSets(2, 15) },
    // Main lifts
    { exerciseId: 'ex-rdl', label: 'Romanian Deadlift', section: 'main', sets: workingSets(sets, reps, 150), notes: 'Hinge at hips, soft bend in knees. Feel the hamstring stretch, not the lower back.' },
    { exerciseId: 'ex-ohp', label: 'Overhead Press', section: 'main', sets: workingSets(sets, reps, 150), notes: 'Squeeze glutes and brace core to prevent lumbar hyperextension.' },
    { exerciseId: 'ex-pullup-band', label: 'Pull-Up Progression', section: 'main', sets: workingSets(sets, 0, 90), notes: 'Band-assisted. Focus on full hang to chin above bar. No kipping.' },
  ]

  if (!isEarlyPhase) {
    const accSets = isMidPhase ? 2 : 3
    exercises.push(
      { exerciseId: 'ex-bulgarian-split-squat', label: 'Bulgarian Split Squat', section: 'accessory', sets: workingSets(accSets, 8, 90), notes: '8 each leg. Bodyweight or very light. Glute drive on the way up.' },
      { exerciseId: 'ex-db-row', label: 'Dumbbell Row', section: 'accessory', sets: workingSets(accSets, 10, 60), notes: '10 each arm.' },
      { exerciseId: 'ex-dead-bugs', label: 'Dead Bugs', section: 'core', sets: coreSets(2, 10), notes: '10 each side. Back stays flat.' },
      { exerciseId: 'ex-bird-dogs', label: 'Bird Dogs', section: 'core', sets: coreSets(2, 10), notes: '10 each side. Hold 2s at extension.' },
    )
  }

  return { id: 'strength_b', label: 'Block Zero: Pull', exercises }
}

// ─── Template Selector ────────────────────────────────────────

/** Pick the correct template based on day of week, block week, and block type. */
export function getStrengthTemplate(
  dayOfWeek: number,
  blockWeek: number = 1,
  blockType: 'fighter' | 'block_zero' = 'fighter',
): StrengthTemplate {
  if (blockType === 'block_zero') {
    return dayOfWeek === 2 ? buildBlockZeroStrengthA(blockWeek) : buildBlockZeroStrengthB(blockWeek)
  }
  return dayOfWeek === 2 ? buildStrengthA(blockWeek) : buildStrengthB(blockWeek)
}

export { buildStrengthA as STRENGTH_A_BUILDER, buildStrengthB as STRENGTH_B_BUILDER }
