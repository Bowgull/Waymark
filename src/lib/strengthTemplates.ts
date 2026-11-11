import { getStrengthWeekTarget } from './blockZero/strength'
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
  // Page 99: Tactical Barbell's 3x5 (the dose moves the wave's 3x3 and the weights).
  if (blockType === 'block_zero') return { sets: 3, reps: 5 }
  const pct = getWeekPercentage(blockWeek)
  if (pct === 0.90) return { sets: 3, reps: 3 }
  return { sets: 3, reps: 5 }
}

/** Get week label for display in Program page. */
export function getWeekLabel(blockWeek: number, blockType: 'fighter' | 'block_zero' = 'fighter'): string {
  const pct = Math.round(getWeekPercentage(blockWeek, blockType) * 100)
  const { sets, reps } = getWaveLoadingSetsReps(blockWeek, blockType)
  if (blockType === 'block_zero') return 'Tactical Barbell · 3×5'
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
 * Page 99 (approved 2026-11-11): Tactical Barbell Fighter, A and B, about 60
 * minutes. Three big lifts at 3x5 (the dose sets the lead-in's work-up and the
 * wave's sets, reps and weights, lib/brain/tbWave.ts), then 2-3 extras and a
 * 3-move core circuit. The landmine where it does the job best: the punch
 * opens B, the press, the reverse lunge and the 180s in B's core.
 */
function buildTbStrengthA(): StrengthTemplate {
  return {
    id: 'strength_a',
    label: 'Block Zero: A',
    exercises: [
      { exerciseId: 'ex-band-pull-aparts', label: 'Band Pull-Aparts', section: 'warmup', sets: warmupSets(1, 15) },
      { exerciseId: 'ex-front-squat', label: 'Front Squat', section: 'main', sets: workingSets(3, 5, 150), notes: 'Elbows high, brace before each rep. Sit between the hips.' },
      { exerciseId: 'ex-bench-press', label: 'Bench Press', section: 'main', sets: workingSets(3, 5, 120) },
      { exerciseId: 'ex-bent-over-row', label: 'Bent-Over Row', section: 'main', sets: workingSets(3, 5, 90), notes: 'Flat back, pull to the lower ribs.' },
      { exerciseId: 'ex-incline-db-press', label: 'Incline DB Press', section: 'accessory', sets: workingSets(3, 10, 45) },
      { exerciseId: 'ex-face-pulls', label: 'Face Pulls', section: 'accessory', sets: workingSets(3, 15, 30) },
      { exerciseId: 'ex-lateral-raise', label: 'Lateral Raise', section: 'accessory', sets: workingSets(2, 12, 30) },
      { exerciseId: 'ex-ab-wheel', label: 'Ab Wheel', section: 'core', sets: coreSets(3, 8), notes: 'From your knees.' },
      { exerciseId: 'ex-hanging-leg-raise', label: 'Hanging Leg Raise', section: 'core', sets: coreSets(3, 10) },
      { exerciseId: 'ex-pallof-press', label: 'Pallof Press', section: 'core', sets: coreSets(3, 10), notes: '10 each side.' },
    ],
  }
}

function buildTbStrengthB(): StrengthTemplate {
  return {
    id: 'strength_b',
    label: 'Block Zero: B',
    exercises: [
      { exerciseId: 'ex-lm-punch', label: 'Landmine Punch', section: 'main', sets: workingSets(3, 4, 60), ramp: false, notes: 'Each side, fast and crisp.' },
      { exerciseId: 'ex-rdl', label: 'Romanian Deadlift', section: 'main', sets: workingSets(3, 5, 150), notes: 'Hips back, spine long. Feel the hamstrings, not the lower back.' },
      { exerciseId: 'ex-landmine-press', label: 'Landmine Press', section: 'main', sets: workingSets(3, 5, 90), ramp: false, notes: 'Each arm.' },
      { exerciseId: 'ex-chin-up-negative', label: 'Chin-Up (Slow Lowering)', section: 'accessory', sets: workingSets(3, 3, 90), notes: 'Jump to the top, lower yourself for 3 to 5 s. Reps only.' },
      { exerciseId: 'ex-lm-reverse-lunge', label: 'Landmine Reverse Lunge', section: 'accessory', sets: workingSets(3, 8, 60), notes: 'Each leg.' },
      { exerciseId: 'ex-db-row', label: 'Dumbbell Row', section: 'accessory', sets: workingSets(3, 10, 45), notes: 'Hand and knee on the bench, flat back, pull to the hip. Each arm.' },
      { exerciseId: 'ex-lm-rotation', label: 'Landmine 180s', section: 'core', sets: coreSets(3, 8), notes: '8 each side.' },
      { exerciseId: 'ex-weighted-dead-bug', label: 'Weighted Dead Bug', section: 'core', sets: coreSets(3, 8), notes: '8 each side.' },
      { exerciseId: 'ex-suitcase-carry', label: 'Suitcase Carry', section: 'core', sets: coreSets(2, 30), notes: '30s each hand. Stand tall, no lean.' },
    ],
  }
}

// ─── Template Selector ────────────────────────────────────────

/**
 * Pick the correct template based on day of week, block week, and block type.
 * Block Zero has two days (A/B, page 99); the session label ("Strength B") wins
 * over the day so a moved session keeps its content.
 */
export function getStrengthTemplate(
  dayOfWeek: number,
  blockWeek: number = 1,
  blockType: 'fighter' | 'block_zero' = 'fighter',
  label?: string | null,
): StrengthTemplate {
  if (blockType === 'block_zero') {
    // Page 99: two days; an older "Strength C" reads as B.
    return strengthDayFor(dayOfWeek, label) === 'A' ? buildTbStrengthA() : buildTbStrengthB()
  }
  return dayOfWeek === 2 ? buildStrengthA(blockWeek) : buildStrengthB(blockWeek)
}
