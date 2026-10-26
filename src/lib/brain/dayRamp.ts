// The coach's day step (rebuild plan Phase 2; page 93 approved 2026-10-25):
// how many training days the week holds, from 4 up to 6 and then 6 with two
// doubled mornings, and back down when life gets busy.
//
// - The plan starts at 4 training days (a returner, not 6 on day one).
// - Up a step after 2 weeks done as planned (one miss a week at most; his own
//   extra sessions count as showing up) with mostly OK mornings. The last
//   step (two doubled mornings) also needs a hard run done in each of those
//   weeks: doubled mornings are a hard run with that day's lift that evening.
// - Down a step after 2 weeks with 2 or more missed each, or 2 weeks of
//   mostly rough mornings.
// - A step holds at least 2 weeks before it moves again.
// - Back from two quiet weeks (nothing done): two steps down, never under 4.
//
// Pure: the server reads the weeks (their stored step, planned, done and
// missed sessions, the mornings) and stores the new week's step on its plan.

import { MAX_STEP, MIN_STEP, stepWords, type DayStep } from './weekBuilder'

export interface RampWeek {
  monday: number
  /** The step that week was planned at (null: no plan stored, e.g. before the one plan). */
  step: DayStep | null
  /** Key sessions planned (the coach's), done (any, his own extras too), missed or skipped by him. */
  planned: number
  done: number
  missed: number
  /** Share of check-ins that week that read AMBER or RED (null: none). */
  roughShare: number | null
  /** A hard run was done that week. */
  hardRunDone: boolean
}

export interface StepPick {
  step: DayStep
  change: 'start' | 'up' | 'down' | 'hold' | 'gap'
  /** One plain line: why this step (page 93 words). */
  why: string
}

export const UP_MAX_MISSED = 1
export const DOWN_MIN_MISSED = 2
export const ROUGH_SHARE = 0.5
export const HOLD_WEEKS = 2

const clampStep = (n: number): DayStep => Math.max(MIN_STEP, Math.min(MAX_STEP, n)) as DayStep

/** The step for the week after `weeks` (oldest first, only weeks of this plan). */
export function nextStep(weeks: readonly RampWeek[]): StepPick {
  const known = weeks.filter(w => w.step != null)
  if (known.length === 0) return { step: MIN_STEP, change: 'start', why: `${stepWords(MIN_STEP)} to start: the coach adds days as you show up.` }
  const current = known[known.length - 1].step as DayStep
  const last2 = weeks.slice(-2)
  // Quiet: nothing done, with sessions planned or no week planned at all (the block paused while he was away).
  if (last2.length === 2 && last2.every(w => w.done === 0 && (w.planned > 0 || w.step == null))) {
    const step = clampStep(current - 2)
    return { step, change: step === current ? 'hold' : 'gap', why: `Back after two quiet weeks: ${stepWords(step)}.` }
  }
  // Weeks at the current step, newest first.
  let held = 0
  for (let i = weeks.length - 1; i >= 0 && weeks[i].step === current; i--) held++
  if (held < HOLD_WEEKS) return { step: current, change: 'hold', why: `${stepWords(current)} again.` }
  const two = weeks.slice(-HOLD_WEEKS)
  const rough = two.every(w => w.roughShare != null && w.roughShare >= ROUGH_SHARE)
  if (two.every(w => w.missed >= DOWN_MIN_MISSED) || rough) {
    const step = clampStep(current - 1)
    if (step !== current) return { step, change: 'down', why: rough ? `Two weeks of rough mornings: ${stepWords(step)} for now.` : `Two busy weeks: ${stepWords(step)} for now. It goes back up when you do.` }
  }
  const asPlanned = two.every(w => w.missed <= UP_MAX_MISSED && w.done > 0 && (w.roughShare == null || w.roughShare < ROUGH_SHARE))
  if (asPlanned && current < MAX_STEP) {
    const doubledNext = current + 1 === MAX_STEP
    if (!doubledNext || two.every(w => w.hardRunDone)) {
      const step = clampStep(current + 1)
      return { step, change: 'up', why: `Two weeks done as planned: up to ${stepWords(step)}.` }
    }
  }
  return { step: current, change: 'hold', why: `${stepWords(current)} again.` }
}
