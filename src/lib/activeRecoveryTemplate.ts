// Static prescription for the Active Recovery session (Reset). Three phases:
//  0) Easy walk or bike, a timed step (audit #15, Josh: "add the walk").
//  1) Hip Mobility — card per movement, timed or rep-based.
//  2) Foam Rolling — big auto-advancing timer that cycles through areas.
//
// Deliberately movements the user already trains (cossack, 90/90, pigeon, CARs)
// so this stays familiar and low-cognitive-load on a recovery day.

export interface HipMobilityMovement {
  id: string
  name: string
  mode: 'hold' | 'reps'
  /** Seconds for hold moves; null for rep moves. Per side when bilateral. */
  holdSec: number | null
  /** Reps per side; null for hold moves. */
  reps: number | null
  bilateral: boolean
  cue: string
}

export const HIP_MOBILITY_MOVEMENTS: HipMobilityMovement[] = [
  {
    id: 'ar-hip-couch-stretch',
    name: 'Couch Stretch',
    mode: 'hold',
    holdSec: 45,
    reps: null,
    bilateral: true,
    cue: 'Back foot on couch, front knee forward. Tuck tailbone, squeeze back glute. Breathe into the stretch.',
  },
  {
    id: 'ar-hip-pigeon',
    name: 'Pigeon Stretch',
    mode: 'hold',
    holdSec: 60,
    reps: null,
    bilateral: true,
    cue: 'Sink into the front hip. Let the top of the back foot rest down. Deep slow breaths.',
  },
  {
    id: 'ar-hip-90-90',
    name: '90/90 Hip Switches',
    mode: 'reps',
    holdSec: null,
    reps: 8,
    bilateral: false,
    cue: 'Slow and controlled. Both knees track through 90 degrees each switch.',
  },
  {
    id: 'ar-hip-cossack',
    name: 'Cossack Squats',
    mode: 'reps',
    holdSec: null,
    reps: 6,
    bilateral: true,
    cue: 'Weight into the bent-leg heel. Opposite leg straight, toe up. Usable range, not max range.',
  },
  {
    id: 'ar-hip-wall-cars',
    name: 'Wall Hip CARs',
    mode: 'reps',
    holdSec: null,
    reps: 5,
    bilateral: true,
    cue: 'Biggest slowest circle you can draw with the knee. Both directions.',
  },
]

export interface FoamRollingArea {
  id: string
  name: string
  /** Seconds per side (or total if not bilateral). */
  sec: number
  bilateral: boolean
  cue: string
}

export const FOAM_ROLLING_AREAS: FoamRollingArea[] = [
  {
    id: 'ar-roll-quads',
    name: 'Quads',
    sec: 45,
    bilateral: true,
    cue: 'Face down, roller under quad. Slow passes. Pause on tender spots, breathe through them.',
  },
  {
    id: 'ar-roll-it-band',
    name: 'IT Band',
    sec: 45,
    bilateral: true,
    cue: 'Side-lying. Roll from just below hip to just above knee. Go slow, do not grind.',
  },
  {
    id: 'ar-roll-glutes',
    name: 'Glutes',
    sec: 45,
    bilateral: true,
    cue: 'Seated on roller, ankle crossed over opposite knee. Lean into the loaded side.',
  },
  {
    id: 'ar-roll-thoracic',
    name: 'Thoracic Spine',
    sec: 60,
    bilateral: false,
    cue: 'Roller across mid-back. Arms crossed. Extend over the roller and breathe into the ribs.',
  },
]

export function totalFoamRollingSeconds(): number {
  return FOAM_ROLLING_AREAS.reduce((acc, a) => acc + (a.bilateral ? a.sec * 2 : a.sec), 0)
}

/** Seconds per foam-rolling step, both sides of a bilateral area in turn (the view's step list). */
export function rollStepSecs(): number[] {
  return FOAM_ROLLING_AREAS.flatMap(area => (area.bilateral ? [area.sec, area.sec] : [area.sec]))
}

/** Reset opens with an easy walk or bike (Josh, audit #15: 10-15 min). */
export const RESET_WALK_MIN = 12

/** A rep's time, and the moment between steps (set up, switch sides), seconds. */
const REP_SEC = 5
const STEP_CHANGE_SEC = 10

/** The hip block's seconds: holds per side, reps per side, and the changes between steps. */
export function hipMobilitySeconds(): number {
  return HIP_MOBILITY_MOVEMENTS.reduce((t, m) => {
    const sides = m.bilateral ? 2 : 1
    const work = m.mode === 'hold' ? (m.holdSec ?? 0) : (m.reps ?? 0) * REP_SEC
    return t + sides * (work + STEP_CHANGE_SEC)
  }, 0)
}

/**
 * Reset's whole length, minutes: the walk, the hip block and the foam rolling. The one number
 * every screen shows for it (plan lines, coach picks, the week's day line, the row's minutes).
 */
export function resetMinutes(walkMin: number = RESET_WALK_MIN): number {
  const rollSec = rollStepSecs().reduce((t, sec) => t + sec + STEP_CHANGE_SEC, 0)
  return Math.round((walkMin * 60 + hipMobilitySeconds() + rollSec) / 60)
}
