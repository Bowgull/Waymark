// Foundation: the daily back-and-neck session (internal type `mobility`).
//
// Design (from the posture and back-care evidence review): build capacity and
// move often, not "hold a correct posture". Exercise helps desk-type back and
// neck pain modestly and adherence matters more than the exact moves; posture
// angles change by a few degrees at most and are only loosely tied to pain.
// So, about 12 minutes every morning in two blocks:
// - Back: breathing, cat-cow, McGill-style trunk endurance (curl-up, bird dog,
//   side plank: sensible low-load work, not a superior method), glute bridge,
//   dowel hinge drill.
// - Neck & shoulders: deep neck flexor holds (chin tucks, 10 x 10 s, the dose
//   used in craniocervical flexion trials), thoracic extension over a roller,
//   doorway pec stretch, prone Y-T raises.
// Three levels, two Block Zero weeks each (weeks 5+ and the Fighter phase hold
// level 3). No duplicates of the strength day: Block Zero A/B/C warm up with
// glute bridges, every strength day has band work or face pulls and rows, and
// the dead bug sits in Strength A. So the daily routine skips the bridge on
// Block Zero strength days, the Y-T raise on any strength day, the hinge drill
// on hinge days (Strength B, Fighter Pull), and has no dead bug.
// A bad-back day (back today <= 2) runs a short version and ends with an easy
// walk (walking is the best-supported "do something" on a sore day). A bad-neck
// day (a neck injury flag) keeps only pain-free chin tucks, the pec stretch and
// shoulder rolls in the neck block. A red flag (back or neck) is breathing only
// and one line to a clinician. Once the muay thai ramp allows clinch, Wednesday
// adds light neck isometrics for clinch tolerance (not concussion prevention).
// Every exercise is one row of FOUNDATION_ROWS: that table is the content.
// Pure.

import { blockZeroTrainingWeek } from './blockZero/weeks'
import type { MobilityExerciseTemplate, MobilitySection } from './mobilityTemplate'

export const FOUNDATION_LABEL = 'Foundation'
/** Labels the daily session carried before the rename; still read as Foundation. */
export const LEGACY_FOUNDATION_LABELS: readonly string[] = ['Back Care']
export const BAD_BACK_THRESHOLD = 2
export const BACK_RED_FLAG_NOTE = 'Back red flag in your notes. No loading today, just easy breathing. See a clinician before training again.'
export const NECK_RED_FLAG_NOTE = 'Neck red flag in your notes. No loading today, just easy breathing. See a clinician before training again.'
export const BAD_BACK_WALK_NOTE = 'Then a 10-15 min easy walk if it feels OK.'
/** Day of week (0 = Sunday) for the clinch-phase neck add-on: a third neck day after Strength A and C. */
export const CLINCH_NECK_DOW = 3

/** The day's strength session, for de-duplication. Block Zero A/B/C, Fighter push/pull. */
export type StrengthKind = 'A' | 'B' | 'C' | 'push' | 'pull'

export interface FoundationInput {
  /** Block Zero week (1-6, extension weeks hold level 3). Null or omitted: Fighter phase, level 3. */
  week?: number | null
  /** "Back today" 1-5 from the check-in, null if not logged. */
  backToday?: number | null
  /** A neck injury flag is active (bad-neck day). */
  neckFlag?: boolean
  /** A red flag in the notes: true or 'back' for the back list, 'neck' for the neck list. */
  redFlag?: boolean | 'back' | 'neck'
  /** The strength session on the same day, if any. */
  strengthDay?: StrengthKind | null
  /** Day of week, 0 = Sunday. */
  dayOfWeek?: number | null
  /** The muay thai ramp allows clinch. */
  clinchAllowed?: boolean
}

export type FoundationLevel = 1 | 2 | 3

/** One prescription. Optional per-level id, label, sides and cue override the row's. */
interface Dose {
  sets: number
  holdSec: number | null
  reps: number | null
  exerciseId?: string
  label?: string
  perSide?: boolean
  note?: string
}
type Slot = Dose | 'skip'

export interface FoundationRow {
  exerciseId: string
  label: string
  section: MobilitySection
  block: 'back' | 'neck'
  perSide?: boolean
  /** Levels 1-3. */
  levels: [Slot, Slot, Slot]
  /** Back today <= 2. */
  badBack: Slot
  /** Neck flag. Neck-block rows only; when set it wins over badBack. */
  badNeck?: Slot
  /** Leave the row out on a day with this strength session. */
  skipOn?: readonly StrengthKind[]
  /** Only on the clinch add-on day once the ramp allows clinch. */
  clinchAddOn?: boolean
  /** The cue line. {reps} and {hold} are filled in. */
  note: string
}

const d = (sets: number, holdSec: number | null, reps: number | null, extra: Partial<Dose> = {}): Dose => ({ sets, holdSec, reps, ...extra })
const all = (x: Slot): [Slot, Slot, Slot] => [x, x, x]
const ANY_STRENGTH: readonly StrengthKind[] = ['A', 'B', 'C', 'push', 'pull']

// ─── The routine (one row per exercise; replace content here) ─────

export const FOUNDATION_ROWS: readonly FoundationRow[] = [
  // Back block (~6-7 min)
  {
    exerciseId: 'ex-crocodile-breathing', label: 'Crocodile Breathing', section: 'breathing', block: 'back',
    levels: all(d(1, 45, null)),
    badBack: d(1, 90, null),
    note: 'About {hold}s. Face down, forehead on your hands. Slow breaths into the low back and sides. A calm start, nothing to fix.',
  },
  {
    exerciseId: 'ex-cat-cow', label: 'Cat-Cow', section: 'lower', block: 'back',
    levels: all(d(1, null, 8)),
    badBack: d(1, null, 6),
    note: '{reps} slow reps with your breath. Move through the range that feels easy, no forcing the ends.',
  },
  {
    exerciseId: 'ex-mcgill-curl-up', label: 'McGill Curl-Up', section: 'lower', block: 'back',
    levels: [d(1, 6, 5), d(1, 8, 5), d(1, 10, 4)],
    badBack: d(1, 6, 3),
    note: '{reps} reps, hold {hold}s each. Hands under the low back, lift head and shoulders a few centimetres. Swap the bent leg halfway.',
  },
  {
    exerciseId: 'ex-bird-dogs', label: 'Bird Dog', section: 'lower', block: 'back', perSide: true,
    levels: [d(1, 5, 5), d(1, 6, 5), d(1, 8, 4, { note: '{reps} each side, hold {hold}s at reach and make a fist with the reaching hand. Hips level, reach long rather than high.' })],
    badBack: d(1, 5, 4),
    note: '{reps} each side, hold {hold}s at reach. Hips level, reach long rather than high.',
  },
  {
    exerciseId: 'ex-side-plank-knees', label: 'Side Plank (Knees)', section: 'lower', block: 'back', perSide: true,
    levels: [d(1, 20, null), d(1, 30, null), d(1, 20, null, { exerciseId: 'ex-side-plank', label: 'Side Plank', note: '{hold}s each side, full side plank. Drop to the knees if the hips sag before the timer ends.' })],
    badBack: d(1, 10, null),
    note: '{hold}s each side, from the knees. Knees, hips and shoulders in one line.',
  },
  {
    exerciseId: 'ex-glute-bridges', label: 'Glute Bridge', section: 'lower', block: 'back',
    levels: [d(1, null, 12), d(1, null, 15), d(1, null, 6, { label: 'Single-Leg Glute Bridge', perSide: true, note: '{reps} each leg, single-leg: the other knee hugged in. Hips stay level, pause at the top.' })],
    badBack: 'skip',
    skipOn: ['A', 'B', 'C'],
    note: '{reps} reps. Squeeze the glutes to lift, ribs down, pause 2s at the top. Push through the heels, not the low back.',
  },
  {
    exerciseId: 'ex-hip-hinge-dowel', label: 'Hip Hinge Drill (Dowel)', section: 'lower', block: 'back',
    levels: [d(1, null, 8), d(1, null, 10), d(1, null, 10, { note: '{reps} slow reps with the dowel, then 5 with a light kettlebell RDL. Hips back, spine long, squeeze to stand.' })],
    badBack: 'skip',
    skipOn: ['B', 'pull'],
    note: '{reps} slow reps. Dowel touches head, upper back and tailbone the whole way. Hips back, then squeeze to stand.',
  },
  // Neck & shoulders block (~5 min)
  {
    exerciseId: 'ex-chin-tucks', label: 'Chin Tuck', section: 'upper', block: 'neck',
    levels: [
      d(1, 10, 10),
      d(1, 10, 10, { note: '{reps} holds of {hold}s, lying down. A gentle nod, as if saying "yes". On the last 3, lift the head about 2 cm off the floor.' }),
      d(1, 10, 7, { note: '{reps} holds of {hold}s, sitting tall with the back of your head against a wall. A gentle nod, chin level, no hard double chin.' }),
    ],
    badBack: d(1, 10, 10),
    badNeck: d(1, 10, 10, { note: '{reps} holds of {hold}s, lying down, pain-free range only. A small gentle nod. Make it smaller if it hurts.' }),
    note: '{reps} holds of {hold}s, lying down, head on the floor or a folded towel. A gentle nod, as if saying "yes". Not a hard double chin.',
  },
  {
    exerciseId: 'ex-chin-tucks', label: 'Chin Tuck Head Lift', section: 'upper', block: 'neck',
    levels: ['skip', 'skip', d(1, 15, 3)],
    badBack: 'skip',
    badNeck: 'skip',
    note: 'Head-lift holds: {reps} x {hold}s. Lying down, nod gently, then lift the head about 2 cm and hold. Stop if the chin pokes forward.',
  },
  {
    exerciseId: 'ex-foam-roll-thoracic', label: 'Thoracic Extension (Foam Roller)', section: 'upper', block: 'neck',
    levels: [d(1, null, 6), d(1, null, 6), d(1, null, 6, { note: 'Roller across the upper back, arms overhead. 3 slow extensions at each of 2 spots. Ribs stay down, the low back stays out of it.' })],
    badBack: 'skip',
    badNeck: 'skip',
    note: 'Roller across the upper back, hands behind the head. 3 slow extensions at each of 2 spots. Ribs stay down. No roller: lean back over a chair back.',
  },
  {
    exerciseId: 'ex-doorway-pec-stretch', label: 'Doorway Pec Stretch', section: 'upper', block: 'neck', perSide: true,
    levels: all(d(1, 30, 2)),
    badBack: d(1, 30, 2),
    badNeck: d(1, 30, 2),
    note: '{reps} x {hold}s each side. Forearm on the door frame, elbow at or just above shoulder height. Step through gently until you feel the front of the chest.',
  },
  {
    exerciseId: 'ex-shoulder-rolls', label: 'Shoulder Rolls', section: 'upper', block: 'neck',
    levels: all('skip'),
    badBack: 'skip',
    badNeck: d(1, null, 10),
    note: '{reps} slow rolls, up, back and down. Easy range, nothing that pinches.',
  },
  {
    exerciseId: 'ex-ytw-raises', label: 'Prone Y-T Raise', section: 'upper', block: 'neck',
    levels: [d(2, null, 8), d(2, null, 10), d(2, null, 8, { note: '{reps} slow reps per set with a 1s pause at the top, thumbs up. Alternate sets: Y, then T. Add 0.5-1 kg when it is easy.' })],
    badBack: 'skip',
    badNeck: 'skip',
    skipOn: ANY_STRENGTH,
    note: '{reps} slow reps per set, thumbs up. Alternate sets: Y (arms overhead at 45 degrees), then T (arms out to the sides). Wall slides work too.',
  },
  // Clinch-phase add-on (Wednesday, once the ramp allows clinch)
  {
    exerciseId: 'ex-neck-iso-4way', label: 'Neck Isometrics (Clinch)', section: 'upper', block: 'neck',
    levels: all(d(2, 20, 4)),
    badBack: d(2, 20, 4),
    badNeck: 'skip',
    clinchAddOn: true,
    note: 'Clinch add-on. Front, back, left, right against a towel or band, {hold}s each. Firm, not max. Nothing moves. Builds tolerance for clinch, not a concussion shield.',
  },
]

/** Level 1 = weeks 1-2, 2 = weeks 3-4, 3 = weeks 5-6 and extensions. Fighter phase (no week): 3. */
export function foundationLevel(week: number | null | undefined): FoundationLevel {
  if (week == null) return 3
  const w = blockZeroTrainingWeek(week)
  return w <= 2 ? 1 : w <= 4 ? 2 : 3
}

export function isBadBackDay(backToday: number | null | undefined): boolean {
  return backToday != null && backToday <= BAD_BACK_THRESHOLD
}

/** The strength session kind from its label: Block Zero "Strength A/B/C", Fighter "Strength: Push/Pull". */
export function strengthKindFromLabel(label: string | null | undefined): StrengthKind | null {
  const bz = label?.match(/Strength ([ABC])\b/)
  if (bz) return bz[1] as StrengthKind
  if (/\bpull\b/i.test(label ?? '')) return 'pull'
  if (/\bpush\b/i.test(label ?? '')) return 'push'
  return null
}

function redFlagRow(region: 'back' | 'neck'): MobilityExerciseTemplate {
  return { exerciseId: 'ex-crocodile-breathing', label: 'Crocodile Breathing', section: 'breathing', sets: 1, holdSec: 120, reps: null, notes: region === 'neck' ? NECK_RED_FLAG_NOTE : BACK_RED_FLAG_NOTE }
}

function fill(note: string, dose: Dose): string {
  return note.replace('{reps}', String(dose.reps ?? '')).replace('{hold}', String(dose.holdSec ?? ''))
}

/** The Foundation routine for a day, built from FOUNDATION_ROWS. */
export function foundationTemplate(input: FoundationInput, rows: readonly FoundationRow[] = FOUNDATION_ROWS): MobilityExerciseTemplate[] {
  if (input.redFlag) return [redFlagRow(input.redFlag === 'neck' ? 'neck' : 'back')]
  const badBack = isBadBackDay(input.backToday)
  const badNeck = input.neckFlag === true
  const level = foundationLevel(input.week)
  const clinchDay = input.clinchAllowed === true && input.dayOfWeek === CLINCH_NECK_DOW
  const out: MobilityExerciseTemplate[] = []
  for (const row of rows) {
    if (row.clinchAddOn && !clinchDay) continue
    if (input.strengthDay && row.skipOn?.includes(input.strengthDay)) continue
    let dose: Slot = row.levels[level - 1]
    if (badNeck && row.block === 'neck' && row.badNeck !== undefined) dose = row.badNeck
    else if (badBack) dose = row.badBack
    if (dose === 'skip') continue
    out.push({
      exerciseId: dose.exerciseId ?? row.exerciseId,
      label: dose.label ?? row.label,
      section: row.section,
      sets: dose.sets,
      holdSec: dose.holdSec,
      reps: dose.reps,
      ...((dose.perSide ?? row.perSide) ? { perSide: true } : {}),
      notes: fill(dose.note ?? row.note, dose),
    })
  }
  if (out.length > 0 && (badBack || badNeck)) {
    const which = badBack && badNeck ? 'Bad back and neck day' : badBack ? 'Bad-back day' : 'Bad-neck day'
    out[0] = { ...out[0], notes: `${out[0].notes} ${which}: pain-free range only.` }
  }
  if (out.length > 0 && badBack) {
    const last = out.length - 1
    out[last] = { ...out[last], notes: `${out[last].notes} ${BAD_BACK_WALK_NOTE}` }
  }
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
