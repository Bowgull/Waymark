// Muay thai ramp for Block Zero. The template never schedules classes; the
// athlete adds them. R12 (Gartland 2001; Strotmeyer 2016): technique, pad and
// bag classes only in the first 2 weeks back; light controlled clinch from
// week 3; no hard sparring anywhere in Block Zero. Beginners ran ~5x the injury
// rate of amateurs, so the ramp counts from the first class, not the block start.
// R15: hard strength and hard MT sit apart, or strength comes first.

import type { PlannedSession } from './autoEase'

/** Class types as MtClassLogView records them. */
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

/** Class types allowed in a ramp week. Sparring is never allowed in Block Zero. */
export function allowedClassTypes(rampWeek: number): MtClassType[] {
  if (rampWeek <= 2) return ['technical', 'padwork']
  return ['technical', 'padwork', 'clinch', 'general']
}

/**
 * Weekly class cap. 2 in ramp weeks 1-2, 3 after, never above a cap set on the
 * profile (the assessment's mtCapPerWeek).
 */
export function weeklyClassCap(rampWeek: number, profileCap?: number | null): number {
  const ramp = rampWeek <= 2 ? 2 : 3
  return profileCap != null && profileCap >= 0 ? Math.min(ramp, profileCap) : ramp
}

export interface ClassRequest {
  classType: string
  weeksSinceFirstClass: number | null
  classesThisWeek: number
  profileCap?: number | null
}

export interface ClassDecision {
  allowed: boolean
  classType: MtClassType | null
  rampWeek: number
  /** What to do instead when refused. */
  suggestedType: MtClassType | null
  reason: string
}

export function evaluateClassRequest(req: ClassRequest): ClassDecision {
  const rampWeek = mtRampWeek(req.weeksSinceFirstClass)
  const type = normaliseClassType(req.classType)
  const cap = weeklyClassCap(rampWeek, req.profileCap)

  if (req.classesThisWeek >= cap) {
    return { allowed: false, classType: type, rampWeek, suggestedType: null, reason: `That makes ${req.classesThisWeek + 1} classes this week. The cap is ${cap} in Block Zero.` }
  }
  if (type === 'sparring') {
    return { allowed: false, classType: type, rampWeek, suggestedType: 'technical', reason: 'No hard sparring in Block Zero. Take the technique class or work pads.' }
  }
  if (type == null) {
    return { allowed: false, classType: null, rampWeek, suggestedType: 'technical', reason: 'Unknown class type. Log it as technique, pads or clinch.' }
  }
  const allowed = allowedClassTypes(rampWeek)
  if (!allowed.includes(type)) {
    return { allowed: false, classType: type, rampWeek, suggestedType: 'technical', reason: `Week ${rampWeek} back. Technique, pads and bag only until week 3.` }
  }
  const note = type === 'clinch' || type === 'general' ? ' Light and controlled. No hard rounds.' : ''
  return { allowed: true, classType: type, rampWeek, suggestedType: null, reason: `Week ${rampWeek} back. ${type === 'padwork' ? 'Pads' : type.charAt(0).toUpperCase() + type.slice(1)} is in.${note}` }
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
