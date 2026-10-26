// Shared session vocabulary for the coach rules: which types exist, which are
// hard, which load the legs, and a planning estimate of minutes and load.
// Pure. Fighter and Block Zero both read these.

import { getRunWalkWeek, runWalkTotalSec } from '../blockZero/running'
import { foundationMinutes } from '../foundation'
import { resetMinutes } from '../activeRecoveryTemplate'
import { ROPE_ROUNDS, ropeMinutes } from '../plannedLength'
import { mondayOf } from '../dates'

export type BlockKind = 'fighter' | 'block_zero'
export type TimeSlot = 'am' | 'pm'

/** Every session type the app can start. Anything else is refused. */
export const KNOWN_SESSION_TYPES: ReadonlySet<string> = new Set([
  'strength',
  'foundation_run',
  'running',
  'skip_rope',
  'bag_work',
  // page 93: the bag's engine session, separate from Bag Work (lib/coach/bagConditioning)
  'bag_conditioning',
  'mt_class',
  'mobility',
  'active_recovery',
])

/** Sessions that count as training exposure (F15): the one list, in lib/keyTypes. */
export { KEY_TYPES } from '../keyTypes'

export const RUN_TYPES: ReadonlySet<string> = new Set(['foundation_run', 'running'])

/** Recovery work never counts against the plan's load. */
export const RECOVERY_TYPES: ReadonlySet<string> = new Set(['mobility', 'active_recovery'])

export interface SessionLike {
  id?: string
  type: string
  label?: string | null
  /** Run category for 'running' ('zone2' | 'progression'), as sessions.notes stores it. */
  notes?: string | null
  /**
   * The week builder's mark (context_json.plan.hard): Bag Work planned as
   * technique only is not hard; Bag Conditioning is hard only when planned so.
   * Missing: the type's own default.
   */
  planHard?: boolean | null
  epochDay: number
  timeSlot: TimeSlot
  status: string
  estimatedMin?: number | null
}

export function dowOf(epochDay: number): number {
  return new Date(epochDay * 86400000).getUTCDay()
}

/** Monday-Sunday weeks everywhere (lib/dates). */
export { mondayOf }

export function isoOf(epochDay: number): string {
  return new Date(epochDay * 86400000).toISOString().slice(0, 10)
}

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** An easy run's planning minutes outside the run-walk weeks (its dose sets the real length). */
const EASY_RUN_MIN = 20

const TYPE_NAME: Record<string, string> = {
  strength: 'Strength',
  foundation_run: 'Easy run',
  running: 'Run',
  mt_class: 'Muay thai',
  bag_work: 'Bag work',
  bag_conditioning: 'Bag Conditioning',
  skip_rope: 'Skip rope',
  mobility: 'Foundation',
  active_recovery: 'Reset',
}

/** A session's name for one-line reasons: its label, else a plain name for the type. */
export function sessionName(s: Pick<SessionLike, 'type' | 'label' | 'notes'>): string {
  if (s.label) return s.label
  if (s.type === 'running' && s.notes === 'progression') return 'Progression run'
  return TYPE_NAME[s.type] ?? s.type.replace(/_/g, ' ')
}

/**
 * A session's name inside a sentence: "Strength A" -> "strength A",
 * "MT Technique" -> "MT technique", "Run-Walk" -> "run-walk". Short capital
 * words (a letter, MT) keep their case (e2e minor 14: "strength a eases").
 */
export function nameInSentence(name: string): string {
  return name.split(' ').map(w => (/^[A-Z0-9]{1,3}$/.test(w) ? w : w.toLowerCase())).join(' ')
}

/** A name that starts a line, one case for all (m17): "Bag Work" -> "Bag work", "Strength C" stays. */
export function nameAtStart(name: string): string {
  const s = nameInSentence(name)
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function isLongRun(s: Pick<SessionLike, 'type' | 'notes' | 'estimatedMin'>): boolean {
  if (s.type !== 'running') return false
  return s.notes === 'progression' || (s.estimatedMin ?? 0) >= 45
}

/**
 * A muay thai class: a fixed 60-minute session, always hard interval work (F1).
 * What is taught is the gym's call, so its label or type never changes how
 * hard it counts (Josh, 2026-10-20; coach-brain §14).
 */
export const CLASS_MINUTES = 60

/**
 * Hard sessions (rebuild plan §1 "Hard days"; review T3): strength, every
 * muay thai class (F1), Tempo, Intervals and the 5K test, Bag Work unless the
 * week planned it as technique only, and a Bag Conditioning planned hard.
 * Easy and long runs (under the heart cap), rope, Foundation and recovery are
 * not.
 */
export function isHard(s: Pick<SessionLike, 'type' | 'label' | 'notes' | 'estimatedMin' | 'planHard'>): boolean {
  if (s.type === 'strength' || s.type === 'mt_class') return true
  if (s.type === 'bag_work') return s.planHard !== false
  if (s.type === 'bag_conditioning') return s.planHard === true
  return isHardRun(s)
}

/**
 * Strength that loads the legs heavily. Fighter strength days both carry a
 * squat or deadlift. Block Zero A (squat), B (hinge) and C too while its
 * reverse lunge is a main lift (rebuild plan: lunges count as heavy legs).
 */
export function isHeavyLegs(s: Pick<SessionLike, 'type' | 'label'>, blockType: BlockKind): boolean {
  void blockType
  return s.type === 'strength'
}

/**
 * A heavy hip hinge (approved 2026-10-21, idea 2): kept 24 h clear of a muay
 * thai class either side (kicks load the hips and lower back). Block Zero B is
 * the hinge day; Fighter's pull day carries the deadlift.
 */
export function isHeavyHinge(s: Pick<SessionLike, 'type' | 'label'>, blockType: BlockKind): boolean {
  if (s.type !== 'strength') return false
  const label = s.label ?? ''
  if (blockType === 'fighter') return /pull|deadlift|hinge/i.test(label)
  const m = label.match(/Strength ([ABC])\b/)
  return m ? m[1] === 'B' : false
}

/**
 * A hard run: Tempo, Intervals or the 5K test (review T3). The long run stays
 * under his heart cap, so it is easy; run-walks and Zone 2 runs are easy.
 */
export function isHardRun(s: Pick<SessionLike, 'type' | 'notes' | 'estimatedMin'>): boolean {
  if (s.type !== 'running') return false
  return s.notes === 'tempo' || s.notes === 'intervals' || s.notes === '5k_test'
}

/** Sessions heavy legs keep 24 h away from (F6; Josh: no heavy legs before a class): every class, and long runs. */
export function isLegInterference(s: Pick<SessionLike, 'type' | 'label' | 'notes' | 'estimatedMin'>): boolean {
  if (s.type === 'mt_class') return true
  return isLongRun(s)
}

const SLOT_HOUR: Record<TimeSlot, number> = { am: 8, pm: 18 }

/** Hours between two sessions, from their day and slot. */
export function hoursBetween(a: Pick<SessionLike, 'epochDay' | 'timeSlot'>, b: Pick<SessionLike, 'epochDay' | 'timeSlot'>): number {
  return Math.abs((a.epochDay * 24 + SLOT_HOUR[a.timeSlot]) - (b.epochDay * 24 + SLOT_HOUR[b.timeSlot]))
}

/**
 * Planning minutes for a session when nothing better is stored: the plan's
 * own numbers (run-walk week, zone 2, progression week), else a type default.
 */
export function estimatedMinutes(s: Pick<SessionLike, 'type' | 'notes' | 'estimatedMin'>, blockType: BlockKind, weekNumber: number): number {
  if (s.estimatedMin != null && s.estimatedMin > 0) return s.estimatedMin
  switch (s.type) {
    case 'foundation_run':
      return blockType === 'block_zero'
        ? Math.round(runWalkTotalSec(getRunWalkWeek(weekNumber)) / 60)
        : EASY_RUN_MIN
    // A Zone 2 run, else a hard run (Tempo, Intervals, the test: about 30 to 40 minutes).
    case 'running': return s.notes === 'zone2' || s.notes === 'easy' ? EASY_RUN_MIN : 35
    case 'strength': return blockType === 'block_zero' ? 60 : 75
    case 'mt_class': return CLASS_MINUTES
    case 'bag_work': return 30
    case 'bag_conditioning': return 30
    case 'skip_rope': return ropeMinutes(ROPE_ROUNDS)
    case 'active_recovery': return resetMinutes()
    case 'mobility': return foundationMinutes({ week: blockType === 'block_zero' ? weekNumber : null })
    default: return 30
  }
}

/** Typical session RPE, so minutes x RPE approximates sRPE load (F1: classes count as hard work). */
const TYPICAL_RPE: Record<string, number> = {
  strength: 7,
  mt_class: 7,
  bag_work: 7,
  // moderate by default; the hard ones (effort 7+) say so in their plan
  bag_conditioning: 6,
  running: 5,
  foundation_run: 4,
  skip_rope: 5,
  active_recovery: 2,
  mobility: 1,
}

export function typicalRpe(s: Pick<SessionLike, 'type' | 'label' | 'notes'>): number {
  if (s.type === 'running' && s.notes === 'progression') return 6
  return TYPICAL_RPE[s.type] ?? 4
}

/** Block Zero weeks 1-2 (and the lead-in) bag is technique and combos only, light power: about RPE 5. */
const EARLY_BLOCK_ZERO_BAG_RPE = 5

export function plannedLoad(s: Pick<SessionLike, 'type' | 'label' | 'notes' | 'estimatedMin'>, blockType: BlockKind, weekNumber: number): number {
  const rpe = s.type === 'bag_work' && blockType === 'block_zero' && weekNumber <= 2 ? EARLY_BLOCK_ZERO_BAG_RPE : typicalRpe(s)
  return estimatedMinutes(s, blockType, weekNumber) * rpe
}
