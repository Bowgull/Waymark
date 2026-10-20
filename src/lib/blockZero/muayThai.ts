// Muay thai classes in Block Zero. The template never schedules classes; the
// athlete adds them. A class is a fixed 60-minute session and what is taught
// is the gym's call (Josh, 2026-10-20: "I'll never be able to decide what I get
// taught"): the coach never says what to do in class or which class to take.
// It only counts each class as an hour of hard work and caps how many a week
// (R12: beginners ran ~5x the injury rate of amateurs, so the cap counts from
// the first class back, not the block start). R15: hard strength and hard MT
// sit apart, or strength comes first.

import type { PlannedSession } from './autoEase'

/** Class types as the MT class log records them (a log field only: nothing is refused by type). */
export type MtClassType = 'technical' | 'padwork' | 'clinch' | 'general' | 'sparring'

const ALIASES: Record<string, MtClassType> = {
  technique: 'technical',
  technical: 'technical',
  pads: 'padwork',
  padwork: 'padwork',
  bag: 'padwork',
  bagwork: 'padwork',
  clinch: 'clinch',
  general: 'general',
  sparring: 'sparring',
  spar: 'sparring',
}

export function normaliseClassType(raw: string): MtClassType | null {
  return ALIASES[raw.toLowerCase().replace(/[^a-z]/g, '')] ?? null
}

/** Ramp week: 1 for the week of the first logged class this block. */
export function mtRampWeek(weeksSinceFirstClass: number | null): number {
  if (weeksSinceFirstClass == null || weeksSinceFirstClass < 0) return 1
  return Math.floor(weeksSinceFirstClass) + 1
}

/**
 * Weekly class cap. 2 in ramp weeks 1-2, 3 after, never above a cap set on the
 * profile (the assessment's mtCapPerWeek). How often, never what kind.
 */
export function weeklyClassCap(rampWeek: number, profileCap?: number | null): number {
  const ramp = rampWeek <= 2 ? 2 : 3
  return profileCap != null && profileCap >= 0 ? Math.min(ramp, profileCap) : ramp
}

export interface ClassRequest {
  weeksSinceFirstClass: number | null
  classesThisWeek: number
  profileCap?: number | null
}

export interface ClassDecision {
  allowed: boolean
  rampWeek: number
  cap: number
  reason: string
}

/** One more class this week: only the weekly cap can say no. The class itself is never judged. */
export function evaluateClassRequest(req: ClassRequest): ClassDecision {
  const rampWeek = mtRampWeek(req.weeksSinceFirstClass)
  const cap = weeklyClassCap(rampWeek, req.profileCap)
  if (req.classesThisWeek >= cap) {
    return { allowed: false, rampWeek, cap, reason: `That makes ${req.classesThisWeek + 1} classes this week. The cap is ${cap} in Block Zero.` }
  }
  return { allowed: true, rampWeek, cap, reason: `Class ${req.classesThisWeek + 1} of ${cap} this week.` }
}

export interface RebalancedDay {
  sessions: PlannedSession[]
  /** Sessions that should move to another day. */
  moved: PlannedSession[]
  reason: string | null
}

const RUN_TYPES = new Set(['foundation_run', 'running'])

/**
 * A class lands on a day. The day's run moves off (class is the conditioning),
 * strength stays but comes first in the AM, one set lighter with an RPE 7 cap.
 * Foundation stays. Pure: returns the new day plus what to move.
 */
export function rebalanceDayForClass(day: PlannedSession[], mtClass: PlannedSession): RebalancedDay {
  const kept: PlannedSession[] = []
  const moved: PlannedSession[] = []
  const notes: string[] = []
  for (const s of day) {
    if (RUN_TYPES.has(s.type) || s.type === 'skip_rope') {
      moved.push(s)
      notes.push('The run moves to another day.')
    } else if (s.type === 'strength') {
      const sets = Math.max(1, (s.sets ?? 2) - 1)
      const hi = Math.min(s.rpe?.[1] ?? 7, 7)
      kept.push({ ...s, timeSlot: 'am', sets, rpe: [Math.min(s.rpe?.[0] ?? hi - 1, hi), hi] })
      notes.push('Strength stays in the morning, one set lighter.')
    } else {
      kept.push(s)
    }
  }
  const classSlot: PlannedSession = { ...mtClass, timeSlot: kept.some(s => s.type === 'strength') ? 'pm' : mtClass.timeSlot }
  const sessions = [...kept, classSlot]
  return { sessions, moved, reason: notes.length > 0 ? `Class tonight. ${notes.join(' ')}` : null }
}
