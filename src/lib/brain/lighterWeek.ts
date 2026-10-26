// A lighter week when his body says so (rebuild Phase 4 leftover, built in
// Phase 8; strength.md #10, coach-brain §6). No fixed deload every N weeks:
// the week is lighter when the week before it showed strain AND rough
// mornings:
//
//   strain    2+ lifts eased in that week (lowered mid-session, cut short,
//             or 1 or fewer reps left), or 2+ sessions he rated 9 or more
//   mornings  2+ AMBER or RED check-ins that week
//
// The lighter week is the same machinery as the one before The Campaign
// (blockMove.ts): same weights and run pieces, fewer sets and rounds, no new
// steps. Never two within 3 weeks, never in the plan's first 3 weeks, never
// on top of the move's own lighter week. Decided per Monday from the days
// before it only, so the whole week reads the same. Pure.

import { readinessState } from './readiness'
import type { AthleteModel, ModelCheckIn, ModelSession } from './types'

/** A hard session he rated this or more counts as strain. */
export const STRAIN_RPE = 9
/** At least this many weeks between two lighter weeks. */
export const LIGHTER_GAP_WEEKS = 3

export const TRIGGERED_WHY = 'Lighter week: last week\'s mornings and sessions say so. Same weights, fewer sets.'
export const TRIGGERED_RUN_WHY = 'Lighter week: same run pieces, fewer rounds.'
export const TRIGGERED_BAG_WHY = 'Lighter week: fewer rounds.'

export interface LighterWeekIn {
  checkIns: readonly ModelCheckIn[]
  sessions: readonly ModelSession[]
  model: Pick<AthleteModel, 'lifts'>
  /** The plan's first day (the block start): no lighter week in its first weeks. */
  planStart: number
}

const dowOf = (day: number) => ((day % 7) + 11) % 7
const mondayOf = (day: number) => day - ((dowOf(day) + 6) % 7)

/** What the 7 days before `monday` showed: eased lifts, hard ratings, rough mornings. */
export function weekStrain(inp: LighterWeekIn, monday: number): { easedLifts: number; hardRatings: number; roughMornings: number } {
  const from = monday - 7
  const inWeek = (d: number) => d >= from && d < monday
  let easedLifts = 0
  for (const l of Object.values(inp.model.lifts)) {
    if ((l.recent ?? []).some(e => inWeek(e.day) && (e.lowered || e.incomplete || (e.lastRir != null && e.lastRir <= 1)))) easedLifts++
  }
  const hardRatings = inp.sessions.filter(s => s.status === 'completed' && inWeek(s.day) && s.rpe != null && s.rpe >= STRAIN_RPE).length
  let roughMornings = 0
  for (let d = from; d < monday; d++) {
    const r = readinessState(inp.checkIns, d)
    if (r.checkedIn && (r.state === 'AMBER' || r.state === 'RED')) roughMornings++
  }
  return { easedLifts, hardRatings, roughMornings }
}

/** The trigger alone for one Monday (no gap rule). */
export function strained(inp: LighterWeekIn, monday: number): boolean {
  const w = weekStrain(inp, monday)
  return (w.easedLifts >= 2 || w.hardRatings >= 2) && w.roughMornings >= 2
}

/**
 * Is the week of `day` a lighter week? Its Monday's trigger fired, the plan
 * is at least 3 weeks in, and none of the 3 Mondays before it fired.
 */
export function triggeredLighter(inp: LighterWeekIn, day: number): boolean {
  const monday = mondayOf(day)
  if (monday < mondayOf(inp.planStart) + 7 * LIGHTER_GAP_WEEKS) return false
  if (!strained(inp, monday)) return false
  for (let k = 1; k <= LIGHTER_GAP_WEEKS; k++) if (strained(inp, monday - 7 * k)) return false
  return true
}
