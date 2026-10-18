// How a session felt (plan §5). Post-session effort (session RPE, and reps in
// reserve on logged strength sets) against the session's target, plus the
// next morning's check-in soreness. Pure.
//
// - Way harder than target, or soreness 4+ the morning after a hard session:
//   the next similar session eases (small, automatic, with a one-line reason,
//   through E1's coachEase).
// - Consistently easier than target feeds the ramp-up ask (rampUp.ts).
//
// Targets: the plan's typical RPE for the session (sessions.ts) and 2 reps in
// reserve on main working sets (RPE 8, never to failure).

import type { CoachEase } from './classify'
import { RUN_TYPES, dowOf, DAY_NAMES, isHard, sessionName, typicalRpe, type SessionLike } from './sessions'

/** Reps in reserve the main working sets aim for. */
export const TARGET_RIR = 2
/** Next-morning soreness (1-5) that eases the next similar session. */
export const SORE_NEXT_DAY = 4
/** How far ahead the next similar session may sit. */
export const NEXT_SIMILAR_WITHIN_DAYS = 7

export type EffortVerdict = 'easier' | 'on_target' | 'harder' | 'way_harder' | 'unknown'

export interface EffortRead {
  sessionId?: string
  epochDay: number
  type: string
  label?: string | null
  notes?: string | null
  /** Session RPE 1-10, as logged on completion. */
  rpe: number | null
  /** Mean reps in reserve on main working sets, when logged. */
  rir?: number | null
  source?: string | null
}

export function targetRpeFor(s: Pick<SessionLike, 'type' | 'label' | 'notes'>): number {
  return typicalRpe(s)
}

/** Effort against target. RPE first; RIR breaks a tie or stands alone. */
export function effortVerdict(e: EffortRead): EffortVerdict {
  const target = targetRpeFor(e)
  const rpe = e.rpe
  const rir = e.rir ?? null
  if (rpe == null && rir == null) return 'unknown'
  if ((rpe != null && rpe >= target + 2) || (rir != null && rir <= TARGET_RIR - 2)) return 'way_harder'
  if ((rpe != null && rpe >= target + 1) || (rir != null && rir <= TARGET_RIR - 1)) return 'harder'
  if ((rpe != null && rpe <= target - 1) || (rpe == null && rir != null && rir >= TARGET_RIR + 1)) {
    // A low RPE with a grinder set is not easy.
    if (rir != null && rir < TARGET_RIR) return 'on_target'
    return 'easier'
  }
  if (rpe != null && rpe <= target && rir != null && rir >= TARGET_RIR + 1) return 'easier'
  return 'on_target'
}

/** Sessions that count as "similar" for the ease: same type, runs as one family. */
export function isSimilar(a: Pick<SessionLike, 'type'>, b: Pick<SessionLike, 'type'>): boolean {
  if (RUN_TYPES.has(a.type) && RUN_TYPES.has(b.type)) return true
  return a.type === b.type
}

export interface FeltHardInput {
  /** The completed session and how it felt. */
  done: EffortRead
  /** Check-in soreness on the morning after `done` (its epochDay + 1). */
  nextMorningSoreness: number | null
  /** Planned sessions from today on (the next similar one is picked from these). */
  upcoming: Array<SessionLike & { id: string; eased?: boolean }>
  todayEpochDay: number
  nowSec: number
}

export interface FeltHardEase {
  targetSessionId: string
  targetEpochDay: number
  ease: CoachEase
  cause: 'effort' | 'soreness'
  fromSessionId: string | null
}

/**
 * The ease for the next similar session, or null. Recovery work never
 * triggers or receives one; a session already eased is left alone.
 */
export function feltHardEase(input: FeltHardInput): FeltHardEase | null {
  const { done } = input
  if (done.type === 'mobility' || done.type === 'active_recovery') return null
  const verdict = effortVerdict(done)
  const sore = input.nextMorningSoreness != null && input.nextMorningSoreness >= SORE_NEXT_DAY && isHard(done)
  if (verdict !== 'way_harder' && !sore) return null
  const next = input.upcoming
    .filter(s => s.status === 'planned' && s.epochDay >= input.todayEpochDay && s.epochDay > done.epochDay && s.epochDay <= done.epochDay + NEXT_SIMILAR_WITHIN_DAYS && isSimilar(s, done))
    .sort((a, b) => a.epochDay - b.epochDay || (a.timeSlot === 'am' ? -1 : 1))[0]
  if (!next || next.eased) return null
  const what = sessionName(done)
  const day = DAY_NAMES[dowOf(done.epochDay)]
  const nextName = sessionName(next)
  const nextDay = DAY_NAMES[dowOf(next.epochDay)]
  const reason = verdict === 'way_harder'
    ? `${what} on ${day} ran well over its target effort. ${nextDay} ${nextName.toLowerCase()} eases.`
    : `Soreness ${input.nextMorningSoreness} the morning after ${day} ${what.toLowerCase()}. ${nextDay} ${nextName.toLowerCase()} eases.`
  return {
    targetSessionId: next.id,
    targetEpochDay: next.epochDay,
    ease: { kind: 'reduce', reason, source: 'reactive', at: input.nowSec },
    cause: verdict === 'way_harder' ? 'effort' : 'soreness',
    fromSessionId: done.sessionId ?? null,
  }
}

export interface EffortSummary {
  sessions: number
  easier: number
  onTarget: number
  harder: number
  wayHarder: number
  /** Mean of logged session RPE. */
  avgRpe: number | null
}

export function summarizeEffort(reads: EffortRead[]): EffortSummary {
  const out: EffortSummary = { sessions: 0, easier: 0, onTarget: 0, harder: 0, wayHarder: 0, avgRpe: null }
  const rpes: number[] = []
  for (const r of reads) {
    if (r.type === 'mobility' || r.type === 'active_recovery') continue
    const v = effortVerdict(r)
    if (v === 'unknown') continue
    out.sessions++
    if (r.rpe != null) rpes.push(r.rpe)
    if (v === 'easier') out.easier++
    else if (v === 'on_target') out.onTarget++
    else if (v === 'harder') out.harder++
    else out.wayHarder++
  }
  out.avgRpe = rpes.length > 0 ? Math.round((rpes.reduce((a, b) => a + b, 0) / rpes.length) * 10) / 10 : null
  return out
}

/** "Consistently easier than target": 2+ easier sessions, none harder. */
export function consistentlyEasier(s: EffortSummary): boolean {
  return s.easier >= 2 && s.harder === 0 && s.wayHarder === 0 && s.easier >= s.onTarget
}
