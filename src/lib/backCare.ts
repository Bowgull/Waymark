// Back Care: the daily Block Zero session.
//
// Structure (stays): one routine per day, progressed across the block weeks,
// a gentler version when "back today" is 2 or less, and the F17 stop on a
// back red flag (no loaded moves, breathing only, one line to a clinician).
// Every exercise is one row of BACK_CARE_ROWS below: the content is a draft
// and that table is the one place to replace it (a posture / back-care
// research pass is pending; naming of the session is undecided).
//
// Draft content, from the evidence files' low back pain section: general
// exercise helps non-specific low back pain modestly and no single type wins;
// motor control work is no better than other exercise; McGill-style trunk
// endurance (curl-up, side plank, bird dog) is sensible, low-load programming,
// not a superior method. So: breathing, segmental movement, trunk endurance,
// glutes, hinge patterning and gentle hip mobility, 10-15 minutes. Pure.

import { blockZeroTrainingWeek } from './blockZero/weeks'
import type { MobilityExerciseTemplate, MobilitySection } from './mobilityTemplate'

export const BACK_CARE_LABEL = 'Back Care'
export const BACK_CARE_GENTLE_THRESHOLD = 2
export const BACK_CARE_RED_FLAG_NOTE = 'Back red flag in your notes. No loading today, just easy breathing. See a clinician before training again.'

export interface BackCareInput {
  /** Block week (1-6, extension weeks hold week 5). */
  week: number
  /** "Back today" 1-5 from the check-in, null if not logged. */
  backToday?: number | null
  redFlag?: boolean
}

/** One prescription: hold seconds and/or reps (per side when the row is per side). */
interface Dose {
  holdSec: number | null
  reps: number | null
}

export interface BackCareRow {
  exerciseId: string
  label: string
  section: MobilitySection
  sets: number
  perSide?: boolean
  /** Weeks 1-6, in order. Extension weeks use week 5. */
  weeks: [Dose, Dose, Dose, Dose, Dose, Dose]
  /** The back-today <= 2 dose, or 'skip' to leave the row out on a gentle day. */
  gentle: Dose | 'skip'
  /** A harder variation from a week on (side plank knees -> full), not on gentle days. */
  progression?: { fromWeek: number; exerciseId: string; label: string; note: (d: Dose) => string }
  /** The cue line. {reps} and {hold} are filled in. */
  note: string
}

const d = (holdSec: number | null, reps: number | null): Dose => ({ holdSec, reps })

// ─── The exercise list (draft; replace here) ─────────────────────

export const BACK_CARE_ROWS: readonly BackCareRow[] = [
  {
    exerciseId: 'ex-crocodile-breathing', label: 'Crocodile Breathing', section: 'breathing', sets: 1,
    weeks: [d(60, null), d(60, null), d(60, null), d(60, null), d(60, null), d(60, null)],
    gentle: d(90, null),
    note: 'Face down, forehead on your hands. Slow breaths into the low back and sides.',
  },
  {
    exerciseId: 'ex-cat-cow', label: 'Cat-Cow', section: 'lower', sets: 1,
    weeks: [d(null, 8), d(null, 8), d(null, 8), d(null, 8), d(null, 8), d(null, 8)],
    gentle: d(null, 6),
    note: '{reps} slow reps with your breath. Move through the range that feels easy, no forcing the ends.',
  },
  {
    exerciseId: 'ex-mcgill-curl-up', label: 'McGill Curl-Up', section: 'lower', sets: 1,
    weeks: [d(6, 5), d(8, 5), d(8, 6), d(10, 6), d(10, 6), d(10, 5)],
    gentle: d(6, 3),
    note: '{reps} reps, hold {hold}s each. Hands under the low back, lift head and shoulders a few centimetres. Swap the bent leg halfway.',
  },
  {
    exerciseId: 'ex-bird-dogs', label: 'Bird Dog', section: 'lower', sets: 1, perSide: true,
    weeks: [d(5, 5), d(6, 5), d(6, 6), d(7, 6), d(8, 6), d(8, 5)],
    gentle: d(5, 4),
    note: '{reps} each side, hold {hold}s at reach. Hips level, reach long rather than high.',
  },
  {
    exerciseId: 'ex-side-plank-knees', label: 'Side Plank (Knees)', section: 'lower', sets: 1, perSide: true,
    weeks: [d(15, null), d(20, null), d(25, null), d(30, null), d(20, null), d(20, null)],
    gentle: d(10, null),
    progression: { fromWeek: 5, exerciseId: 'ex-side-plank', label: 'Side Plank', note: x => `${x.holdSec}s each side, full side plank. Drop to the knees if the hips sag before the timer ends.` },
    note: '{hold}s each side, from the knees. Knees, hips and shoulders in one line.',
  },
  {
    exerciseId: 'ex-dead-bugs', label: 'Dead Bug', section: 'lower', sets: 1, perSide: true,
    weeks: [d(null, 6), d(null, 6), d(null, 8), d(null, 8), d(null, 8), d(null, 8)],
    gentle: d(null, 5),
    note: '{reps} each side. Low back stays heavy on the floor. Slow out, slow back.',
  },
  {
    exerciseId: 'ex-glute-bridges', label: 'Glute Bridge', section: 'lower', sets: 2,
    weeks: [d(null, 10), d(null, 10), d(null, 12), d(null, 12), d(null, 12), d(null, 12)],
    gentle: d(null, 8),
    note: '{reps} reps. Squeeze the glutes to lift, ribs down, pause 2s at the top. Push through the heels, not the low back.',
  },
  {
    exerciseId: 'ex-hip-hinge-dowel', label: 'Hip Hinge Drill (Dowel)', section: 'lower', sets: 1,
    weeks: [d(null, 8), d(null, 8), d(null, 10), d(null, 10), d(null, 10), d(null, 8)],
    gentle: 'skip',
    note: '{reps} slow reps. Dowel touches head, upper back and tailbone the whole way. Hips back, then squeeze to stand.',
  },
  {
    exerciseId: 'ex-hip-flexor-stretch', label: 'Hip Flexor Stretch', section: 'lower', sets: 1, perSide: true,
    weeks: [d(30, null), d(30, null), d(30, null), d(30, null), d(30, null), d(30, null)],
    gentle: d(30, null),
    note: '{hold}s each side. Half-kneeling, tuck the tailbone and squeeze the back glute. Gentle stretch, no arching.',
  },
]

/** The row shown on a red-flag day: breathing only. */
const RED_FLAG_ROW: MobilityExerciseTemplate = {
  exerciseId: 'ex-crocodile-breathing', label: 'Crocodile Breathing', section: 'breathing', sets: 1, holdSec: 120, reps: null, notes: BACK_CARE_RED_FLAG_NOTE,
}

function fill(note: string, dose: Dose): string {
  return note.replace('{reps}', String(dose.reps ?? '')).replace('{hold}', String(dose.holdSec ?? ''))
}

export function isGentleDay(backToday: number | null | undefined): boolean {
  return backToday != null && backToday <= BACK_CARE_GENTLE_THRESHOLD
}

/** The Back Care routine for a day, built from BACK_CARE_ROWS. */
export function backCareTemplate(input: BackCareInput, rows: readonly BackCareRow[] = BACK_CARE_ROWS): MobilityExerciseTemplate[] {
  if (input.redFlag) return [{ ...RED_FLAG_ROW }]
  const gentle = isGentleDay(input.backToday)
  const week = blockZeroTrainingWeek(input.week)
  const out: MobilityExerciseTemplate[] = []
  for (const row of rows) {
    const dose = gentle ? row.gentle : row.weeks[week - 1]
    if (dose === 'skip') continue
    const advanced = !gentle && row.progression && week >= row.progression.fromWeek ? row.progression : null
    out.push({
      exerciseId: advanced ? advanced.exerciseId : row.exerciseId,
      label: advanced ? advanced.label : row.label,
      section: row.section,
      sets: row.sets,
      holdSec: dose.holdSec,
      reps: dose.reps,
      ...(row.perSide ? { perSide: true } : {}),
      notes: advanced ? advanced.note(dose) : fill(row.note, dose),
    })
  }
  if (gentle && out.length > 0) out[0] = { ...out[0], notes: `${out[0].notes} Gentle day: pain-free range only.` }
  return out
}

// ─── Timer steps (shared with every mobility routine) ─────────────

export interface MobilityStep {
  kind: 'hold' | 'reps'
  holdSec: number | null
  reps: number | null
  /** 1-based rep for a rep-with-hold step. */
  rep: number | null
  side: 'Left' | 'Right' | null
}

/**
 * What one set of a mobility row runs as. Holds per side time both sides;
 * reps with a hold (prone cobra 10 x 3s) run as one timed hold per rep;
 * plain reps are one tap ("each side" in the copy when per side).
 */
export function mobilitySteps(ex: { holdSec: number | null; reps?: number | null; perSide?: boolean | number | null }): MobilityStep[] {
  const perSide = ex.perSide === true || ex.perSide === 1
  const sides: Array<'Left' | 'Right' | null> = perSide ? ['Left', 'Right'] : [null]
  const hold = ex.holdSec != null && ex.holdSec > 0 ? ex.holdSec : null
  const reps = ex.reps != null && ex.reps > 0 ? ex.reps : null
  if (!hold) return [{ kind: 'reps', holdSec: null, reps, rep: null, side: null }]
  const steps: MobilityStep[] = []
  for (const side of sides) {
    if (reps) {
      for (let r = 1; r <= reps; r++) steps.push({ kind: 'hold', holdSec: hold, reps, rep: r, side })
    } else {
      steps.push({ kind: 'hold', holdSec: hold, reps: null, rep: null, side })
    }
  }
  return steps
}

/**
 * Rough length of a routine in seconds: work time plus ~10 s per step change
 * and 20 s between sets. Slow control reps ~4 s; dynamic drills ~2 s.
 */
export function estimateRoutineSec(rows: MobilityExerciseTemplate[]): number {
  let sec = 0
  for (const row of rows) {
    const steps = mobilitySteps(row)
    const secPerRep = row.section === 'dynamic' ? 2 : 4
    const perSet = steps.reduce((t, s) => t + (s.kind === 'hold' ? (s.holdSec ?? 0) + (s.rep != null ? 2 : 10) : (s.reps ?? 8) * secPerRep * (row.perSide ? 2 : 1)), 0)
    sec += perSet * row.sets + (row.sets - 1) * 20 + 15
  }
  return sec
}
