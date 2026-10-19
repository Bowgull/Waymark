// Shared session vocabulary for the coach rules: which types exist, which are
// hard, which load the legs, and a planning estimate of minutes and load.
// Pure. Fighter and Block Zero both read these.

import { ZONE2_PRESCRIPTION, RUNNING_PLAN_TEMPLATE } from '../runningPlanTemplate'
import { getRunWalkWeek, runWalkTotalSec } from '../blockZero/running'
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
  'mt_class',
  'mobility',
  'active_recovery',
])

/** Sessions that count as training exposure (F15). Foundation and recovery are habits, not doses. */
export const KEY_TYPES: ReadonlySet<string> = new Set(['strength', 'foundation_run', 'running', 'skip_rope', 'bag_work', 'mt_class'])

export const RUN_TYPES: ReadonlySet<string> = new Set(['foundation_run', 'running'])

/** Recovery work never counts against the plan's load. */
export const RECOVERY_TYPES: ReadonlySet<string> = new Set(['mobility', 'active_recovery'])

export interface SessionLike {
  id?: string
  type: string
  label?: string | null
  /** Run category for 'running' ('zone2' | 'progression'), as sessions.notes stores it. */
  notes?: string | null
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

const TYPE_NAME: Record<string, string> = {
  strength: 'Strength',
  foundation_run: 'Easy run',
  running: 'Run',
  mt_class: 'Muay thai',
  bag_work: 'Bag work',
  skip_rope: 'Rope',
  mobility: 'Foundation',
  active_recovery: 'Recovery',
}

/** A session's name for one-line reasons: its label, else a plain name for the type. */
export function sessionName(s: Pick<SessionLike, 'type' | 'label' | 'notes'>): string {
  if (s.label) return s.label
  if (s.type === 'running' && s.notes === 'progression') return 'Progression run'
  return TYPE_NAME[s.type] ?? s.type.replace(/_/g, ' ')
}

export function isLongRun(s: Pick<SessionLike, 'type' | 'notes' | 'estimatedMin'>): boolean {
  if (s.type !== 'running') return false
  return s.notes === 'progression' || (s.estimatedMin ?? 0) >= 45
}

/** A class labelled technique or drills is skill work; anything else is hard interval work (F1). */
export function isTechnicalClass(label: string | null | undefined): boolean {
  return /techni|drill|fundament/i.test(label ?? '')
}

export function isSparring(label: string | null | undefined): boolean {
  return /spar/i.test(label ?? '')
}

/**
 * Hard sessions for the "no two hard sessions on one day" rule (F6, F14):
 * strength, muay thai (classes are hard interval work, F1; a technique class
 * is not), bag work and long runs. Easy runs, rope, Foundation and recovery are not.
 */
export function isHard(s: Pick<SessionLike, 'type' | 'label' | 'notes' | 'estimatedMin'>): boolean {
  if (s.type === 'strength' || s.type === 'bag_work') return true
  if (s.type === 'mt_class') return !isTechnicalClass(s.label)
  return isLongRun(s)
}

/**
 * Strength that loads the legs heavily. Fighter strength days both carry a
 * squat or deadlift. Block Zero A (squat) and B (hinge); C is row and lunge.
 */
export function isHeavyLegs(s: Pick<SessionLike, 'type' | 'label'>, blockType: BlockKind): boolean {
  if (s.type !== 'strength') return false
  if (blockType === 'fighter') return true
  const m = (s.label ?? '').match(/Strength ([ABC])\b/)
  return m ? m[1] !== 'C' : true
}

/** Sessions heavy legs keep 24 h away from (F6): sparring or hard muay thai, and long runs. */
export function isLegInterference(s: Pick<SessionLike, 'type' | 'label' | 'notes' | 'estimatedMin'>): boolean {
  if (s.type === 'mt_class') return !isTechnicalClass(s.label)
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
        : Math.round((ZONE2_PRESCRIPTION.targetDurSec ?? 2100) / 60)
    case 'running': {
      if (s.notes === 'zone2') return Math.round((ZONE2_PRESCRIPTION.targetDurSec ?? 2100) / 60)
      const plan = RUNNING_PLAN_TEMPLATE.find(r => r.weekNumber === Math.min(Math.max(1, weekNumber), 12))
      return Math.round((plan?.targetDurSec ?? 1800) / 60)
    }
    case 'strength': return blockType === 'block_zero' ? 60 : 75
    case 'mt_class': return 90
    case 'bag_work': return 30
    case 'skip_rope': return 15
    case 'active_recovery': return 25
    case 'mobility': return 12
    default: return 30
  }
}

/** Typical session RPE, so minutes x RPE approximates sRPE load (F1: classes count as hard work). */
const TYPICAL_RPE: Record<string, number> = {
  strength: 7,
  mt_class: 7,
  bag_work: 7,
  running: 5,
  foundation_run: 4,
  skip_rope: 5,
  active_recovery: 2,
  mobility: 1,
}

export function typicalRpe(s: Pick<SessionLike, 'type' | 'label' | 'notes'>): number {
  if (s.type === 'running' && s.notes === 'progression') return 6
  if (s.type === 'mt_class' && isTechnicalClass(s.label)) return 5
  return TYPICAL_RPE[s.type] ?? 4
}

/** Block Zero weeks 1-2 (and the lead-in) bag is technique and combos only, light power: about RPE 5. */
const EARLY_BLOCK_ZERO_BAG_RPE = 5

export function plannedLoad(s: Pick<SessionLike, 'type' | 'label' | 'notes' | 'estimatedMin'>, blockType: BlockKind, weekNumber: number): number {
  const rpe = s.type === 'bag_work' && blockType === 'block_zero' && weekNumber <= 2 ? EARLY_BLOCK_ZERO_BAG_RPE : typicalRpe(s)
  return estimatedMinutes(s, blockType, weekNumber) * rpe
}
