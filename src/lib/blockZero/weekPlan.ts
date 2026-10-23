// Block Zero weekly shape, as data the existing template system consumes.
//
// Full gym, 5-6 training days, 60-90 min:
// - 3 full-body strength days, A/B/C on Mon/Wed/Fri (R2: 2-3 sessions/wk).
// - 3 run-walk days on Tue/Thu/Sat. The day after a heavy-leg day (A squat,
//   B hinge) may swap to rope (R15: non-running aerobic next to leg days).
// - Foundation (the daily back-and-neck session, type mobility) every day, ~12 min.
// - Durability (neck, wrist/forearm, grip) inside Strength A and C, so twice a week.
// - Sunday has no training load. Foundation stays daily, it is the habit.
// - Strength sits before any other piece on a shared day (R15).
// - No muay thai classes. The athlete adds them; see muayThai.ts for the ramp.

import type { TemplateSession } from '../weeklyTemplate'
import { FOUNDATION_LABEL } from '../foundation'
import { getRunWalkWeek, runWalkTotalSec } from './running'
import { blockZeroPhase, type BlockZeroPhase } from './weeks'
import { HARD_NOTES, HARD_START_LABEL, hardWeek, type HardKind } from '../brain/hardRuns'

export type StrengthDay = 'A' | 'B' | 'C'

export interface BlockZeroTemplateSession extends TemplateSession {
  /** Allowed swap for this slot (rope in place of a run the day after legs). */
  alternativeType?: string
  strengthDay?: StrengthDay
}

export const STRENGTH_DAY_BY_DOW: Record<number, StrengthDay> = { 1: 'A', 3: 'B', 5: 'C' }

/**
 * Strength day for a session. The stored label wins ("Strength B"), so a
 * moved session keeps its content; otherwise the day of week decides, with
 * off-template days mapped to a nearby slot.
 */
export function strengthDayFor(dayOfWeek: number, label?: string | null): StrengthDay {
  const m = label?.match(/Strength ([ABC])\b/)
  if (m) return m[1] as StrengthDay
  const direct = STRENGTH_DAY_BY_DOW[dayOfWeek]
  if (direct) return direct
  if (dayOfWeek === 0) return 'A'
  if (dayOfWeek === 2) return 'B'
  return 'C'
}

const FOUNDATION: BlockZeroTemplateSession = { timeSlot: 'am', type: 'mobility', label: FOUNDATION_LABEL, estimatedMin: 12 }

const STRENGTH_MIN: Record<BlockZeroPhase, number> = { test: 55, build: 60, consolidate: 45, extension: 60 }

function runWalk(week: number, alternative: boolean): BlockZeroTemplateSession {
  return {
    timeSlot: 'am',
    type: 'foundation_run',
    label: 'Run-Walk',
    estimatedMin: Math.round(runWalkTotalSec(getRunWalkWeek(week)) / 60),
    ...(alternative ? { alternativeType: 'skip_rope' } : {}),
  }
}

/**
 * A hard run (page 76, approved 2026-10-23): from week 4, Tuesday is steady
 * hard and Saturday run hard / jog. The nightly pass keeps the week's balance
 * and places the 5K test when he is ready (lib/brain/hardRuns.ts).
 */
function hardRun(kind: HardKind): BlockZeroTemplateSession {
  return { timeSlot: 'am', type: 'running', label: HARD_START_LABEL[kind], estimatedMin: kind === 'steady' ? 30 : 40, runCategory: HARD_NOTES[kind] as 'tempo' | 'intervals' | '5k_test' }
}

function strength(day: StrengthDay, phase: BlockZeroPhase): BlockZeroTemplateSession {
  return { timeSlot: 'am', type: 'strength', label: `Strength ${day}`, estimatedMin: STRENGTH_MIN[phase], strengthDay: day }
}

/** Day-of-week → sessions for a Block Zero week. Keys 0=Sun .. 6=Sat. */
export function getBlockZeroWeekTemplate(weekNumber: number): Record<number, BlockZeroTemplateSession[]> {
  const phase = blockZeroPhase(weekNumber)
  // Test weeks carry no extra session (2026-10-18): the fixed-effort rope test
  // went with the HR-at-fixed-effort test. The guided tests run on their own screen.
  const monday = [FOUNDATION, strength('A', phase)]

  return {
    0: [FOUNDATION],
    1: monday,
    2: [FOUNDATION, hardWeek(weekNumber) ? hardRun('steady') : runWalk(weekNumber, true)],
    3: [FOUNDATION, strength('B', phase)],
    4: [FOUNDATION, runWalk(weekNumber, true)],
    5: [FOUNDATION, strength('C', phase)],
    6: [FOUNDATION, hardWeek(weekNumber) ? hardRun('intervals') : runWalk(weekNumber, false)],
  }
}

const RUN_TYPES = new Set(['foundation_run', 'running'])

/** R15 check: on a shared day, strength comes before any running. */
export function strengthBeforeRunning(day: TemplateSession[]): boolean {
  const firstRun = day.findIndex(s => RUN_TYPES.has(s.type))
  const lastStrength = day.map(s => s.type).lastIndexOf('strength')
  if (firstRun === -1 || lastStrength === -1) return true
  return lastStrength < firstRun
}
