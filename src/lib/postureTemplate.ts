export interface PostureExerciseTemplate {
  exerciseId: string
  label: string
  sets: number
  holdSec: number | null // null = rep-based, not timed hold
  reps: number | null    // null = hold-based, not rep-based
  notes?: string
}

export const POSTURE_TEMPLATE: PostureExerciseTemplate[] = [
  {
    exerciseId: 'ex-doorway-pec-stretch',
    label: 'Doorway Pec Stretch',
    sets: 2,
    holdSec: 30,
    reps: null,
    notes: '30s each side',
  },
  {
    exerciseId: 'ex-cat-cow',
    label: 'Cat-Cow',
    sets: 2,
    holdSec: null,
    reps: 10,
  },
  {
    exerciseId: 'ex-chin-tucks',
    label: 'Chin Tucks',
    sets: 2,
    holdSec: 5,
    reps: 10,
    notes: 'Hold 5s each rep',
  },
  {
    exerciseId: 'ex-wall-slides',
    label: 'Wall Slides',
    sets: 2,
    holdSec: null,
    reps: 10,
  },
  {
    exerciseId: 'ex-foam-roller-thoracic',
    label: 'Foam Roller Thoracic Extensions',
    sets: 2,
    holdSec: 30,
    reps: null,
  },
  {
    exerciseId: 'ex-prone-y-raises',
    label: 'Prone Y Raises',
    sets: 2,
    holdSec: 3,
    reps: 10,
    notes: 'Hold 3s at top each rep',
  },
]
