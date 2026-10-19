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
// reserve on main working sets (RPE 8, never to failure). Block Zero strength
// reads its own week's band instead (D5): RPE 6-7 / 3-4 left in weeks 1-2,
// RPE 5-6 in the lead-in, 7-8 / 2-3 from week 3. Lead-in work and Block Zero
// week 1 (the work-up) never feed the "felt easier" side (no false push).

import type { CoachEase } from './classify'
import { LEAD_IN_TARGET, RIR_MAX, RIR_THREE_PLUS_AS, getStrengthWeekTarget } from '../blockZero/strength'
import { RUN_TYPES, dowOf, DAY_NAMES, isHard, nameInSentence, sessionName, typicalRpe, type SessionLike } from './sessions'

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
  /** The session's own effort band (Block Zero strength), else the type's typical RPE and 2 RIR. */
  target?: EffortTarget | null
  /** Lead-in or Block Zero week 1: never counts toward "felt easier". */
  noEasierRead?: boolean
}

export interface EffortTarget {
  rpe: [number, number]
}

/**
 * Effort band for a Block Zero strength session: the lead-in intro band, else
 * the block week's band. Other sessions keep the typical-RPE target.
 */
export function blockZeroEffortTarget(s: { type: string; blockType?: string | null; blockWeek?: number | null; leadIn?: boolean }): EffortTarget | null {
  if (s.type !== 'strength' || s.blockType !== 'block_zero') return null
  const t = s.leadIn ? LEAD_IN_TARGET : getStrengthWeekTarget(s.blockWeek ?? 1)
  return { rpe: [t.rpe[0], t.rpe[1]] }
}

/** Reads that must not suggest a push: the lead-in, and Block Zero week 1's work-up. */
export function noEasierReadFor(s: { blockType?: string | null; blockWeek?: number | null; leadIn?: boolean; weekNumber?: number | null }): boolean {
  if (s.blockType !== 'block_zero') return false
  return s.leadIn === true || (s.weekNumber ?? s.blockWeek ?? 2) <= 1
}

export function targetRpeFor(s: Pick<SessionLike, 'type' | 'label' | 'notes'>): number {
  return typicalRpe(s)
}

/** Effort against target. RPE first; RIR breaks a tie or stands alone. */
export function effortVerdict(e: EffortRead): EffortVerdict {
  const rpe = e.rpe
  const rir = e.rir ?? null
  if (rpe == null && rir == null) return 'unknown'
  if (e.target) return bandVerdict(e.target, rpe, rir)
  const target = targetRpeFor(e)
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

/**
 * Verdict against an RPE band. RIR reads as RPE 10 - RIR (the app's "3 or
 * more" is 3.5), the same reading the load step uses: on target inside the
 * band, harder above it, way harder 2+ above, easier when either reading sits
 * below it (and neither above).
 */
function bandVerdict(t: EffortTarget, rpe: number | null, rir: number | null): EffortVerdict {
  const [lo, hi] = t.rpe
  // The tap tops out at "3 or more": when the band itself sits at 4+ left (the
  // lead-in), a top-of-scale reading can't say more, so it doesn't count against it.
  // Logged RIR tops out at 3 ("3 or more"), read as 3.5 like the load step does.
  const r = rir != null && rir >= RIR_MAX ? RIR_THREE_PLUS_AS : rir
  const capped = r != null && r >= RIR_THREE_PLUS_AS && 10 - hi >= RIR_THREE_PLUS_AS
  const fromRir = r != null && !capped ? 10 - r : null
  const top = Math.max(rpe ?? -Infinity, fromRir ?? -Infinity)
  if (top >= hi + 2) return 'way_harder'
  if (top > hi) return 'harder'
  // Nothing above the band by here, so either reading under it is easier.
  if ((rpe != null && rpe < lo) || (fromRir != null && fromRir < lo)) return 'easier'
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
    ? `${what} on ${day} ran well over its target effort. ${nextDay} ${nameInSentence(nextName)} eases.`
    : `Soreness ${input.nextMorningSoreness} the morning after ${day} ${nameInSentence(what)}. ${nextDay} ${nameInSentence(nextName)} eases.`
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
    // Lead-in and the week-1 work-up are easy by design: they never read as "ready to push".
    if (r.noEasierRead && (v === 'easier' || v === 'on_target')) continue
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
