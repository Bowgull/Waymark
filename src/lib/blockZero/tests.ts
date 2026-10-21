// Block Zero test results (block_tests rows). Week 1 sets the baselines, week 3
// adds the e1RM check (R4), week 6 retests everything (R16). Extension weeks
// may retest again. Keys are fixed so trends compare like with like; the
// simple checks track change, they don't predict injury (evidence myth list).

import { e1rmFromRir } from './e1rm'
import { BLOCK_ZERO_BASE_WEEKS, BLOCK_ZERO_MAX_WEEKS } from './weeks'

export type TestUnit = 'kg' | 'reps' | 's' | 'bpm' | 'score' | 'cm' | 'deg'

interface TestSpec {
  units: readonly TestUnit[]
  min: number
  max: number
}

const REPS: TestSpec = { units: ['reps'], min: 0, max: 500 }
const SECONDS: TestSpec = { units: ['s'], min: 0, max: 3600 }
const HEART_RATE: TestSpec = { units: ['bpm'], min: 30, max: 230 }

export const FIXED_TEST_KEYS: Readonly<Record<string, TestSpec>> = {
  pushups_max: REPS,
  side_plank_sec_l: SECONDS,
  side_plank_sec_r: SECONDS,
  calf_raise_reps_l: REPS,
  calf_raise_reps_r: REPS,
  talk_test_hr: HEART_RATE,
  fixed_effort_hr: HEART_RATE,
}

const E1RM_SPEC: TestSpec = { units: ['kg'], min: 0.5, max: 500 }
// Mobility check: a 1-5 self score, or a measure (knee-to-wall cm, rotation deg).
const MOBILITY_SPEC: TestSpec = { units: ['score', 'cm', 'deg'], min: 0, max: 180 }
export const MOBILITY_AREAS = ['hips', 'ankle_l', 'ankle_r', 'ankles', 'thoracic', 'hamstrings', 'shoulders'] as const

/** Weeks a result can be logged for: 1, 3, 6, then any extension week. */
export function isTestWeek(week: number, totalWeeks: number): boolean {
  if (!Number.isInteger(week)) return false
  if (week === 1 || week === 3 || week === BLOCK_ZERO_BASE_WEEKS) return true
  return week > BLOCK_ZERO_BASE_WEEKS && week <= Math.min(totalWeeks, BLOCK_ZERO_MAX_WEEKS)
}

export function e1rmTestKey(exerciseId: string): string {
  return `e1rm:${exerciseId}`
}

export type ParsedTestKey =
  | { kind: 'fixed'; key: string; spec: TestSpec }
  | { kind: 'e1rm'; key: string; exerciseId: string; spec: TestSpec }
  | { kind: 'mobility'; key: string; area: string; spec: TestSpec }

export function parseTestKey(key: string): ParsedTestKey | null {
  if (FIXED_TEST_KEYS[key]) return { kind: 'fixed', key, spec: FIXED_TEST_KEYS[key] }
  const e1rm = key.match(/^e1rm:(ex-[a-z0-9-]+)$/)
  if (e1rm) return { kind: 'e1rm', key, exerciseId: e1rm[1], spec: E1RM_SPEC }
  const mob = key.match(/^mobility:([a-z_]+)$/)
  if (mob && (MOBILITY_AREAS as readonly string[]).includes(mob[1])) return { kind: 'mobility', key, area: mob[1], spec: MOBILITY_SPEC }
  return null
}

export interface TestResultInput {
  week: number
  testKey: string
  value: number
  unit?: string | null
  notes?: string | null
}

export type TestValidation =
  | { ok: true; week: number; testKey: string; value: number; unit: TestUnit; notes: string | null; exerciseId: string | null }
  | { ok: false; error: string }

/**
 * Validate one result. Unit defaults to the key's first unit; a given unit
 * must be one the key allows. Exercise existence is the caller's job (DB).
 */
export function validateTestResult(input: TestResultInput, totalWeeks: number): TestValidation {
  // The talk test is asked on any week the coach wants the line rechecked (coach brain P2: first run, then rechecks).
  const talk = input.testKey === 'talk_test_hr' && Number.isInteger(input.week) && input.week >= 1 && input.week <= Math.max(totalWeeks, 52)
  if (!talk && !isTestWeek(input.week, totalWeeks)) {
    return { ok: false, error: `Week ${input.week} has no tests. Use 1, 3, ${BLOCK_ZERO_BASE_WEEKS} or an extension week.` }
  }
  const parsed = typeof input.testKey === 'string' ? parseTestKey(input.testKey) : null
  if (!parsed) return { ok: false, error: `Unknown test key: ${String(input.testKey)}.` }
  const unit = (input.unit ?? parsed.spec.units[0]) as TestUnit
  if (!parsed.spec.units.includes(unit)) {
    return { ok: false, error: `${parsed.key} is logged in ${parsed.spec.units.join(' or ')}, not ${unit}.` }
  }
  if (typeof input.value !== 'number' || !Number.isFinite(input.value) || input.value < parsed.spec.min || input.value > parsed.spec.max) {
    return { ok: false, error: `${parsed.key} must be a number from ${parsed.spec.min} to ${parsed.spec.max}.` }
  }
  if (parsed.kind === 'mobility' && unit === 'score' && (input.value < 1 || input.value > 5)) {
    return { ok: false, error: `${parsed.key} score is 1-5.` }
  }
  if (input.notes != null && (typeof input.notes !== 'string' || input.notes.length > 500)) {
    return { ok: false, error: 'Notes must be text, 500 characters at most.' }
  }
  return {
    ok: true,
    week: input.week,
    testKey: parsed.key,
    value: input.value,
    unit,
    notes: input.notes ?? null,
    exerciseId: parsed.kind === 'e1rm' ? parsed.exerciseId : null,
  }
}

// ─── e1RM from a logged check set (R4) ─────────────────────────

export interface LoggedCheckSet {
  /** Block week of the session (3 and 6 carry the check set). */
  week: number
  section: string | null
  isWarmup: boolean
  plannedReps: number | null
  weightKg: number | null
  reps: number
  rir: number | null
}

/** Check sets are 3-5 reps; the working sets of 8 never count. */
export const CHECK_SET_MAX_PLANNED_REPS = 5

/**
 * The e1RM a logged week-3/6 check set produces, or null. Needs weight, reps
 * <= 10 and RIR; reps + RIR must stay within the 10-rep accuracy limit.
 * RIR 3 means "3 or more", so it counts as 3: the estimate errs low.
 */
export function checkSetE1rm(set: LoggedCheckSet): number | null {
  if (set.week !== 3 && set.week !== BLOCK_ZERO_BASE_WEEKS) return null
  if (set.section !== 'main' || set.isWarmup) return null
  if (set.plannedReps == null || set.plannedReps > CHECK_SET_MAX_PLANNED_REPS) return null
  if (set.weightKg == null || set.rir == null || set.reps < 1 || set.reps > 10) return null
  return e1rmFromRir(set.weightKg, set.reps, set.rir)
}

/** Best e1RM per lift from block_tests rows ('e1rm:<id>'), for the given weeks. */
export function e1rmsFromTests(rows: Array<{ week: number; testKey: string; value: number }>, weeks: (w: number) => boolean): Map<string, number> {
  const best = new Map<string, number>()
  for (const r of rows) {
    if (!weeks(r.week)) continue
    const parsed = parseTestKey(r.testKey)
    if (parsed?.kind !== 'e1rm') continue
    if (r.value > (best.get(parsed.exerciseId) ?? 0)) best.set(parsed.exerciseId, r.value)
  }
  return best
}
