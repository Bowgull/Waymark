// The athlete model decides within the rules only (plan §7). Pure.
// - loadFactor stays inside 0.85-1.05 (spec §6, never > +5% a session).
// - No push on an ease day, after a gap (return ramp) or with an injury flag:
//   push verdicts become hold, factors above 1 drop to 1, push_volume becomes
//   as_planned.
// - The state expires after 10 days. A stale state never sets loads.
// - One line (the note) is shown to the athlete; the rest stays stored.

import { clampLoadFactor } from './liftTrends'
import type { AthleteState } from './types'

export const ATHLETE_STATE_TTL_SEC = 10 * 86400
const VERDICT_MAX = 140

export interface AthleteGuardContext {
  /** Return ramp after a gap or an injury flag: no pushing. */
  noPush: boolean
  /** Readiness ease or load flag today. */
  easeActive: boolean
}

export interface GuardedAthleteState {
  state: AthleteState
  clamps: string[]
}

function oneLine(s: string): string {
  const clean = s.replace(/\s*[—–]\s*/g, ', ').replace(/!+/g, '.').replace(/\s{2,}/g, ' ').trim()
  return clean.length <= VERDICT_MAX ? clean : `${clean.slice(0, VERDICT_MAX - 1).replace(/[\s,.;:]+\S*$/, '')}.`
}

export function guardAthleteState(state: AthleteState, ctx: AthleteGuardContext): GuardedAthleteState {
  const clamps: string[] = []
  const hold = ctx.noPush || ctx.easeActive
  const lifts = state.lifts.map(l => {
    let loadFactor = clampLoadFactor(l.loadFactor)
    if (loadFactor !== l.loadFactor) clamps.push(`${l.exerciseId}: loadFactor ${l.loadFactor} -> ${loadFactor}`)
    let verdict = l.verdict
    if (hold && (verdict === 'push' || loadFactor > 1)) {
      clamps.push(`${l.exerciseId}: no push (${ctx.noPush ? 'gap or injury' : 'ease day'})`)
      verdict = verdict === 'push' ? 'hold' : verdict
      loadFactor = Math.min(1, loadFactor)
    }
    return { ...l, verdict, loadFactor }
  })
  let weekShape = state.weekShape
  if (hold && weekShape === 'push_volume') {
    clamps.push('weekShape push_volume -> as_planned')
    weekShape = 'as_planned'
  }
  const verdict = oneLine(state.note || state.readinessRationale || '')
  return {
    state: { ...state, lifts, weekShape, verdict, expiresAtEpoch: state.computedAtEpoch + ATHLETE_STATE_TTL_SEC, guardrails: clamps },
    clamps,
  }
}

/** Fresh until 10 days after it was computed (or its stored expiry). */
export function isAthleteStateFresh(state: Pick<AthleteState, 'computedAtEpoch' | 'expiresAtEpoch'>, nowSec: number): boolean {
  const expires = state.expiresAtEpoch ?? state.computedAtEpoch + ATHLETE_STATE_TTL_SEC
  return nowSec < expires
}
