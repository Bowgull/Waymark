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

// ─── Wave Loading ─────────────────────────────────────────────

/** Get wave loading percentage for a given block week (1-6, repeating). */
export function getWeekPercentage(blockWeek: number): number {
  const w = ((blockWeek - 1) % 6) + 1
  if (w === 1 || w === 4) return 0.75
  if (w === 2 || w === 5) return 0.80
  return 0.90 // w === 3 || w === 6
}

/** Get sets × reps for main lifts based on block week. */
export function getWaveLoadingSetsReps(blockWeek: number): { sets: number; reps: number } {
  const pct = getWeekPercentage(blockWeek)
  if (pct === 0.90) return { sets: 3, reps: 3 }
  return { sets: 3, reps: 5 }
}

/** Get week percentage label for display. */
export function getWeekLabel(blockWeek: number): string {
  const pct = Math.round(getWeekPercentage(blockWeek) * 100)
  const { sets, reps } = getWaveLoadingSetsReps(blockWeek)
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

// ─── Templates ────────────────────────────────────────────────

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
      // Core Circuit A, Anti-Extension (15-18 min)
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
      // Core Circuit B, Rotational + Anti-Lateral (15-18 min)
      { exerciseId: 'ex-body-saw', label: 'Body Saw', section: 'core', sets: coreSets(3, 10) },
      { exerciseId: 'ex-cable-woodchop', label: 'Cable Woodchop', section: 'core', sets: coreSets(3, 10), notes: '10 each side' },
      { exerciseId: 'ex-weighted-dead-bug', label: 'Weighted Dead Bug', section: 'core', sets: coreSets(3, 10), notes: '10 each side' },
      { exerciseId: 'ex-suitcase-carry', label: 'Suitcase Carry', section: 'core', sets: coreSets(3, 30), notes: '30s each hand' },
    ],
  }
}

/** Pick template based on day of week and block week. Tuesday (2) = A, Thursday (4) = B. */
export function getStrengthTemplate(dayOfWeek: number, blockWeek: number = 1): StrengthTemplate {
  return dayOfWeek === 2 ? buildStrengthA(blockWeek) : buildStrengthB(blockWeek)
}

export { buildStrengthA as STRENGTH_A_BUILDER, buildStrengthB as STRENGTH_B_BUILDER }
