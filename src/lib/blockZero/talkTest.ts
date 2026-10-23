// The talk test (design-decisions "Block Zero tests", page 45 #3): no test week. On the first
// easy run-walk of Block Zero week 1 and of week 6, Log your run asks one extra question, the
// heart rate when full sentences got hard. It is saved as that week's block_tests talk_test_hr
// (POST /api/blocks/:id/tests) and sets the Zone 2 ceiling (running.hrCeiling). Pure.

import { BLOCK_ZERO_BASE_WEEKS } from './weeks'

export const TALK_TEST_KEY = 'talk_test_hr'
/** Week 1 (the baseline) and week 6 (the retest before the gate). */
export const TALK_TEST_WEEKS: readonly number[] = [1, BLOCK_ZERO_BASE_WEEKS]
/** The drum's range and start (bpm), as the old test week had it. */
export const TALK_TEST_RANGE = { min: 90, max: 210, step: 1, start: 140 } as const

/** Block Zero's easy runs: the run-walk (foundation_run) and a plain easy / Zone 2 run. */
function isEasyRun(sessionType: string, runCategory?: string | null): boolean {
  if (sessionType === 'foundation_run') return true
  return sessionType === 'running' && (runCategory == null || runCategory === 'zone2' || runCategory === 'easy')
}

/**
 * Ask on this run's log? Block Zero, week 1 or 6, an easy run, and no talk-test HR saved for
 * that week yet (so it is the week's first run-walk to log one).
 */
export function talkTestDue(input: {
  blockType: string | null | undefined
  blockWeek: number | null | undefined
  sessionType: string
  runCategory?: string | null
  /** This week's saved results (GET /api/blocks/:id/tests?week=N). */
  weekResults: ReadonlyArray<{ testKey: string; week?: number }>
}): boolean {
  if (input.blockType !== 'block_zero') return false
  const week = input.blockWeek ?? 0
  if (!TALK_TEST_WEEKS.includes(week)) return false
  if (!isEasyRun(input.sessionType, input.runCategory)) return false
  return !input.weekResults.some(r => r.testKey === TALK_TEST_KEY && (r.week == null || r.week === week))
}

export function clampTalkHr(bpm: number): number {
  if (!Number.isFinite(bpm)) return TALK_TEST_RANGE.start
  return Math.min(TALK_TEST_RANGE.max, Math.max(TALK_TEST_RANGE.min, Math.round(bpm)))
}

/** The drum's first value: the run's average HR when it is in range, else 140. */
export function talkTestStart(avgHr: number | null | undefined): number {
  return avgHr != null && avgHr >= TALK_TEST_RANGE.min && avgHr <= TALK_TEST_RANGE.max ? Math.round(avgHr) : TALK_TEST_RANGE.start
}

/**
 * What SAVE RUN posts (audit #1): the talk test only when he set the drum himself. An untouched
 * drum saves nothing (the week stays "not tested"), so a seeded 140 never becomes his cap.
 */
export function talkTestToSave(week: number, bpm: number, touched: boolean): ReturnType<typeof talkTestBody> | null {
  return touched ? talkTestBody(week, bpm) : null
}

/** The body for POST /api/blocks/:id/tests. */
export function talkTestBody(week: number, bpm: number): { week: number; testKey: string; value: number; unit: 'bpm' } {
  return { week, testKey: TALK_TEST_KEY, value: clampTalkHr(bpm), unit: 'bpm' }
}
