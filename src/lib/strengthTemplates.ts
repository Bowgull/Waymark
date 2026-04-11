export interface TemplateSet {
  isWarmup: boolean
  targetReps: number // 0 = max reps
  restSec: number
}

export interface TemplateExercise {
  exerciseId: string
  label: string
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

export const STRENGTH_A: StrengthTemplate = {
  id: 'strength_a',
  label: 'Strength A + Core',
  exercises: [
    { exerciseId: 'ex-face-pulls', label: 'Face Pulls', sets: warmupSets(2, 15) },
    { exerciseId: 'ex-band-pull-aparts', label: 'Band Pull-Aparts', sets: warmupSets(2, 15) },
    { exerciseId: 'ex-front-squat', label: 'Front Squat', sets: workingSets(3, 5, 180) },
    { exerciseId: 'ex-landmine-press', label: 'Landmine Press', sets: workingSets(3, 8, 120), notes: 'Try OHP if shoulders feel good' },
    { exerciseId: 'ex-pullup-band', label: 'Pull-Up Progression', sets: workingSets(3, 0, 120), notes: 'Band → Negatives → Full. Log what you can do.' },
    { exerciseId: 'ex-hanging-leg-raise', label: 'Hanging Leg Raise', sets: coreSets(3, 10) },
    { exerciseId: 'ex-ab-wheel', label: 'Ab Wheel Roll-Out', sets: coreSets(3, 10) },
    { exerciseId: 'ex-v-ups', label: 'V-Ups', sets: coreSets(3, 15) },
  ],
}

export const STRENGTH_B: StrengthTemplate = {
  id: 'strength_b',
  label: 'Strength B + Core',
  exercises: [
    { exerciseId: 'ex-face-pulls', label: 'Face Pulls', sets: warmupSets(2, 15) },
    { exerciseId: 'ex-band-pull-aparts', label: 'Band Pull-Aparts', sets: warmupSets(2, 15) },
    { exerciseId: 'ex-front-squat', label: 'Front Squat Heavy', sets: workingSets(5, 3, 180) },
    { exerciseId: 'ex-incline-db-press', label: 'Incline DB Press', sets: workingSets(3, 10, 120) },
    { exerciseId: 'ex-bent-over-row', label: 'Bent Over Row', sets: workingSets(3, 8, 120) },
    { exerciseId: 'ex-pullup-band', label: 'Pull-Up Progression', sets: workingSets(3, 0, 120), notes: 'Band → Negatives → Full. Log what you can do.' },
    { exerciseId: 'ex-russian-twists', label: 'Russian Twists', sets: coreSets(3, 20) },
    { exerciseId: 'ex-side-plank-lift', label: 'Side Plank + Lift', sets: coreSets(3, 30), notes: '30s each side' },
  ],
}

/** Pick template based on day of week. Tuesday (2) = A, else B. */
export function getStrengthTemplate(dayOfWeek: number): StrengthTemplate {
  return dayOfWeek === 2 ? STRENGTH_A : STRENGTH_B
}
