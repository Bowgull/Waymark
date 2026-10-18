// Test week (Block Zero Phase C, direction 2): guided, one test per step with
// one big entry, building a baseline card; AND a results sheet to fill gaps
// or fix a number later. Week 1 sets the baselines, week 6 (and extension
// weeks) retest them; week 3's check is the strength check set (logged from
// the effort tap, no entry here). Keys and limits are the server's
// (src/lib/blockZero/tests.ts). Pure.

import { isTestWeek, parseTestKey, type TestUnit } from '@/lib/blockZero/tests'
import { BLOCK_ZERO_BASE_WEEKS } from '@/lib/blockZero/weeks'

export type TestEntry = 'number' | 'score'

export interface TestSpecUI {
  key: string
  label: string
  /** One line: how to do it. */
  how: string
  unit: TestUnit
  entry: TestEntry
  min: number
  max: number
  step: number
  start: number
}

const SCORE_HOW = (part: string) => `How freely your ${part} move today: 1 is locked, 5 is free.`

/** The guided tests, in the order they're done. */
export const GUIDED_TESTS: readonly TestSpecUI[] = [
  { key: 'talk_test_hr', label: 'Talk-test HR', how: 'Run-walk easy. Note your heart rate where full sentences start to get hard.', unit: 'bpm', entry: 'number', min: 90, max: 210, step: 1, start: 140 },
  { key: 'fixed_effort_hr', label: 'HR at fixed effort', how: 'The 20-minute bike or rope piece at a set pace. Your average heart rate.', unit: 'bpm', entry: 'number', min: 60, max: 210, step: 1, start: 140 },
  { key: 'pushups_max', label: 'Push-ups', how: 'One set, as many as you can with good form.', unit: 'reps', entry: 'number', min: 0, max: 150, step: 1, start: 15 },
  { key: 'side_plank_sec_l', label: 'Side plank · left', how: 'Hold on your left side until your form breaks.', unit: 's', entry: 'number', min: 0, max: 600, step: 5, start: 30 },
  { key: 'side_plank_sec_r', label: 'Side plank · right', how: 'Hold on your right side until your form breaks.', unit: 's', entry: 'number', min: 0, max: 600, step: 5, start: 30 },
  { key: 'calf_raise_reps_l', label: 'Calf raises · left', how: 'Single leg, full range, until you can’t do another.', unit: 'reps', entry: 'number', min: 0, max: 150, step: 1, start: 15 },
  { key: 'calf_raise_reps_r', label: 'Calf raises · right', how: 'Single leg, full range, until you can’t do another.', unit: 'reps', entry: 'number', min: 0, max: 150, step: 1, start: 15 },
  { key: 'mobility:hips', label: 'Hips', how: SCORE_HOW('hips'), unit: 'score', entry: 'score', min: 1, max: 5, step: 1, start: 3 },
  { key: 'mobility:ankles', label: 'Ankles', how: SCORE_HOW('ankles'), unit: 'score', entry: 'score', min: 1, max: 5, step: 1, start: 3 },
  { key: 'mobility:thoracic', label: 'Upper back', how: 'How freely your upper back turns today: 1 is locked, 5 is free.', unit: 'score', entry: 'score', min: 1, max: 5, step: 1, start: 3 },
]

// Every guided key must be one the server accepts.
for (const t of GUIDED_TESTS) {
  if (!parseTestKey(t.key)) throw new Error(`testWeek: unknown test key ${t.key}`)
}

/** What a week asks for: the full set in week 1 and from week 6 on; none in week 3 (the check set is logged in Strength). */
export function testsForWeek(week: number, totalWeeks: number): readonly TestSpecUI[] {
  if (!isTestWeek(week, totalWeeks)) return []
  if (week === 1 || week >= BLOCK_ZERO_BASE_WEEKS) return GUIDED_TESTS
  return []
}

export function weekTestTitle(week: number): string {
  if (week === 1) return 'BASELINE · WEEK 1'
  if (week === 3) return 'CHECK · WEEK 3'
  return `RETEST · WEEK ${week}`
}

// ─── Guided steps ─────────────────────────────────────────────

export interface GuidedState {
  index: number
  /** The value on the dial for each step (what NEXT saves). */
  dial: Record<string, number>
  /** Saved this run (key -> value). */
  saved: Record<string, number>
  done: boolean
}

export type GuidedAction =
  | { type: 'dial'; value: number }
  | { type: 'next' }
  | { type: 'skip' }
  | { type: 'back' }

export function initialGuided(tests: readonly TestSpecUI[], existing: Record<string, number> = {}): GuidedState {
  const dial: Record<string, number> = {}
  for (const t of tests) dial[t.key] = existing[t.key] ?? t.start
  // Start on the first test without a result.
  const first = tests.findIndex(t => existing[t.key] == null)
  return { index: first === -1 ? 0 : first, dial, saved: {}, done: tests.length === 0 }
}

export function clampToSpec(spec: Pick<TestSpecUI, 'min' | 'max' | 'step'>, value: number): number {
  const stepped = Math.round(value / spec.step) * spec.step
  return Math.min(spec.max, Math.max(spec.min, stepped))
}

export function guidedReducer(tests: readonly TestSpecUI[], state: GuidedState, action: GuidedAction): GuidedState {
  const spec = tests[state.index]
  switch (action.type) {
    case 'dial':
      if (!spec || state.done) return state
      return { ...state, dial: { ...state.dial, [spec.key]: clampToSpec(spec, action.value) } }
    case 'next': {
      if (!spec || state.done) return state
      const saved = { ...state.saved, [spec.key]: state.dial[spec.key] }
      const index = state.index + 1
      return { ...state, saved, index, done: index >= tests.length }
    }
    case 'skip': {
      if (state.done) return state
      const index = state.index + 1
      return { ...state, index, done: index >= tests.length }
    }
    case 'back':
      if (state.index <= 0) return state
      return { ...state, index: state.index - 1, done: false }
  }
}

/** POST /api/blocks/:id/tests body for what this run saved. */
export function testsPayload(week: number, saved: Record<string, number>, tests: readonly TestSpecUI[] = GUIDED_TESTS) {
  return tests
    .filter(t => saved[t.key] != null)
    .map(t => ({ week, testKey: t.key, value: saved[t.key], unit: t.unit }))
}

// ─── Results sheet ────────────────────────────────────────────

export interface TestRowIn {
  week: number
  testKey: string
  value: number
  unit?: string | null
}

export interface SheetRow {
  key: string
  label: string
  /** "142 bpm", "45 s", "18", "3/5"; null = not entered yet. */
  value: string | null
  editable: boolean
}

/** "ex-trap-bar-deadlift" -> "Trap bar deadlift". */
export function liftNameFromId(exerciseId: string): string {
  const words = exerciseId.replace(/^ex-/, '').split('-').filter(Boolean)
  if (words.length === 0) return exerciseId
  const s = words.join(' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function formatTestValue(value: number, unit: string | null | undefined): string {
  const n = Number.isInteger(value) ? String(value) : value.toFixed(1)
  switch (unit) {
    case 'bpm': return `${n} bpm`
    case 's': return `${n} s`
    case 'kg': return `${n} kg`
    case 'score': return `${n}/5`
    case 'cm': return `${n} cm`
    case 'deg': return `${n}°`
    default: return n
  }
}

/** Every test for the week: guided tests in order (entered or "enter"), then lift estimates from the check sets. */
export function sheetRows(week: number, totalWeeks: number, rows: readonly TestRowIn[]): SheetRow[] {
  const forWeek = rows.filter(r => r.week === week)
  const byKey = new Map(forWeek.map(r => [r.testKey, r]))
  const out: SheetRow[] = testsForWeek(week, totalWeeks).map(t => {
    const r = byKey.get(t.key)
    return { key: t.key, label: t.label, value: r ? formatTestValue(r.value, r.unit ?? t.unit) : null, editable: true }
  })
  for (const r of forWeek) {
    const parsed = parseTestKey(r.testKey)
    if (parsed?.kind !== 'e1rm') continue
    out.push({ key: r.testKey, label: `${liftNameFromId(parsed.exerciseId)} · est. max`, value: formatTestValue(r.value, 'kg'), editable: false })
  }
  return out
}

export function existingValues(week: number, rows: readonly TestRowIn[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) if (r.week === week) out[r.testKey] = r.value
  return out
}
