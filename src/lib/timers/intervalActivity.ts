// The interval timer's lock card and Dynamic Island (page 81 §4, page 82's
// last row): ROUND 3 OF 8, the phase word, the system's own countdown to the
// part's end, the pause stone. The grass fills the current part in the
// phase's colour (gold work, teal rest and get ready, orange near the end) and
// glows brighter once at each part change. Never an end or a log from there.

import type { ActivityState } from '../liveActivity'
import { intervalGlow } from '../lockGlow'
import { phaseWord, type IntervalClock, type IntervalPart, type IntervalPosition } from './intervalTimer'

export const INTERVAL_SESSION_LABEL = 'Interval timer'

/** The part's start on the wall clock (pauses before it pushed in), epoch ms. */
export function partStartMs(clock: IntervalClock, part: IntervalPart): number {
  return clock.startedAtMs + clock.pausedMs + part.startSec * 1000
}

/**
 * The card's state. Every time in it is fixed while the part runs (no "now"),
 * so it is only sent again when something on the card changes.
 */
export function intervalActivityState(pos: IntervalPosition, clock: IntervalClock, rounds: number): ActivityState {
  const { part } = pos
  const paused = clock.pausedAtMs != null
  const start = partStartMs(clock, part)
  const endsAt = paused ? clock.pausedAtMs! + Math.max(0, pos.left) * 1000 : start + part.len * 1000
  const startedAt = endsAt - part.len * 1000
  return {
    phase: part.ph === 'work' ? 'active' : 'rest',
    label: phaseWord(part.ph),
    startedAt,
    endsAt,
    isPaused: paused,
    pausedRemaining: paused ? Math.max(0, Math.round(pos.left)) : undefined,
    round: part.round,
    roundTotal: rounds,
    stepIndex: part.round,
    stepTotal: rounds,
    ...intervalGlow(pos.index, part.ph, pos.warn && !paused),
  }
}
