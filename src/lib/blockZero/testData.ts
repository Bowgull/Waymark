// Block Zero test data for the AI calls: week-1 baselines per lift (test row
// or the logged work-up), the training-max ceiling they allow, and week-1 vs
// retest deltas for the transition. Pure: callers pass rows in.
//
// Week 1 work-up is a set of 8 with 3-4 left (R1). 8 + RIR is past the
// 10-rep accuracy limit (R4), so the estimate caps reps-to-failure at 10: it
// errs low, which is the safe side for a ceiling. TM = 90% of e1RM (Phase A).

import { E1RM_MAX_REPS, epley } from './e1rm'
import { TM_FROM_E1RM, TM_FROM_E1RM_ADJUST } from './endGate'
import { effectiveRir, latestRirTopSet, type LoggedWorkingSet } from './strength'
import { FIXED_TEST_KEYS, parseTestKey } from './tests'
import { BLOCK_ZERO_BASE_WEEKS } from './weeks'

export interface TestRow {
  week: number
  testKey: string
  value: number
  unit?: string | null
}

export interface WorkupSet extends LoggedWorkingSet {
  exerciseId: string
}

export interface LiftBaseline {
  exerciseId: string
  e1rmKg: number
  source: 'test' | 'workup'
  workup: { weightKg: number; reps: number; rir: number } | null
}

function roundHalf(kg: number): number {
  return Math.round(kg * 2) / 2
}

/** Conservative e1RM from a work-up top set: reps + RIR, capped at 10. */
export function workupE1rm(weightKg: number, reps: number, rir: number): number | null {
  const toFailure = Math.min(E1RM_MAX_REPS, reps + effectiveRir(rir))
  return epley(weightKg, Math.max(1, Math.round(toFailure)))
}

/**
 * Week-1 baseline per lift. A logged 'e1rm:<id>' test row wins; otherwise
 * the heaviest RIR-logged working set of the work-up (sets of 8).
 */
export function week1LiftBaselines(rows: TestRow[], workupSets: WorkupSet[]): Map<string, LiftBaseline> {
  const out = new Map<string, LiftBaseline>()
  const byLift = new Map<string, WorkupSet[]>()
  for (const s of workupSets) {
    const list = byLift.get(s.exerciseId) ?? []
    list.push(s)
    byLift.set(s.exerciseId, list)
  }
  for (const [exerciseId, sets] of byLift) {
    const top = latestRirTopSet(sets, 8)
    if (!top || top.weightKg == null || top.rir == null) continue
    const e1rm = workupE1rm(top.weightKg, top.reps, top.rir)
    if (e1rm == null) continue
    out.set(exerciseId, { exerciseId, e1rmKg: e1rm, source: 'workup', workup: { weightKg: top.weightKg, reps: top.reps, rir: top.rir } })
  }
  for (const r of rows) {
    if (r.week !== 1) continue
    const parsed = parseTestKey(r.testKey)
    if (parsed?.kind !== 'e1rm' || !(r.value > 0)) continue
    const prev = out.get(parsed.exerciseId)
    out.set(parsed.exerciseId, { exerciseId: parsed.exerciseId, e1rmKg: r.value, source: 'test', workup: prev?.workup ?? null })
  }
  return out
}

/** Highest training max a week-1 baseline allows (90% of e1RM, 0.5 kg). */
export function calibrationCeilingKg(baseline: Pick<LiftBaseline, 'e1rmKg'>): number {
  return roundHalf(baseline.e1rmKg * TM_FROM_E1RM)
}

/** Training-max ceiling from a retest e1RM: 90%, or 85% on an adjust decision. */
export function retestCeilingKg(e1rmKg: number, decision: string): number {
  return roundHalf(e1rmKg * (decision === 'adjust' ? TM_FROM_E1RM_ADJUST : TM_FROM_E1RM))
}

/** True once any week-1 result is in: from then on only test-backed maxes are saved. */
export function hasWeek1Tests(rows: TestRow[], baselines: Map<string, LiftBaseline>): boolean {
  return baselines.size > 0 || rows.some(r => r.week === 1)
}

// ─── Fixed tests and deltas ───────────────────────────────────

const FIXED_LABELS: Record<string, string> = {
  talk_test_hr: 'Talk-test HR',
  fixed_effort_hr: 'HR at fixed effort',
  pushups_max: 'Push-ups',
  side_plank_sec_l: 'Side plank L',
  side_plank_sec_r: 'Side plank R',
  calf_raise_reps_l: 'Calf raises L',
  calf_raise_reps_r: 'Calf raises R',
}

const FIXED_UNITS: Record<string, string> = { talk_test_hr: 'bpm', fixed_effort_hr: 'bpm', side_plank_sec_l: 's', side_plank_sec_r: 's' }

export interface FixedResult {
  key: string
  label: string
  value: number
  unit: string
}

/** Week-N fixed and mobility results, latest week winning when several match. */
export function fixedResults(rows: TestRow[], weeks: (w: number) => boolean): FixedResult[] {
  const best = new Map<string, TestRow>()
  for (const r of rows) {
    if (!weeks(r.week)) continue
    const parsed = parseTestKey(r.testKey)
    if (!parsed || parsed.kind === 'e1rm') continue
    const prev = best.get(r.testKey)
    if (!prev || r.week > prev.week) best.set(r.testKey, r)
  }
  const order = [...Object.keys(FIXED_TEST_KEYS)]
  return [...best.values()]
    .sort((a, b) => {
      const ia = order.indexOf(a.testKey)
      const ib = order.indexOf(b.testKey)
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.testKey.localeCompare(b.testKey)
    })
    .map(r => ({
      key: r.testKey,
      label: FIXED_LABELS[r.testKey] ?? `Mobility ${r.testKey.slice('mobility:'.length).replace(/_/g, ' ')}`,
      value: r.value,
      unit: r.unit ?? FIXED_UNITS[r.testKey] ?? (r.testKey.startsWith('mobility:') ? 'score' : 'reps'),
    }))
}

export interface TestDelta {
  key: string
  label: string
  unit: string
  week1: number | null
  retest: number | null
  change: number | null
}

const isRetestWeek = (w: number) => w >= BLOCK_ZERO_BASE_WEEKS

/**
 * The only test the gate compares besides the lift estimates (2026-10-18: no
 * test week). Older rows (push-ups, side plank, fixed-effort HR, mobility
 * scores) still validate and read, but no longer feed the gate.
 */
export const GATE_FIXED_KEYS: readonly string[] = ['talk_test_hr']

/**
 * Week 1 against the retest (week 6 or later): the lift estimates and the
 * talk-test HR (GATE_FIXED_KEYS), each with a value on either side. Lift e1RMs use the week-1 baseline (test or work-up) and the
 * retest e1RM map the gate reads. Names come from `liftNames`.
 */
export function testDeltas(
  rows: TestRow[],
  baselines: Map<string, LiftBaseline>,
  retestE1rms: Map<string, number>,
  liftNames: Map<string, string>,
): TestDelta[] {
  const out: TestDelta[] = []
  const liftIds = [...new Set([...baselines.keys(), ...retestE1rms.keys()])]
  for (const id of liftIds) {
    const a = baselines.get(id)?.e1rmKg ?? null
    const b = retestE1rms.get(id) ?? null
    out.push({ key: `e1rm:${id}`, label: `${liftNames.get(id) ?? id} e1RM`, unit: 'kg', week1: a, retest: b, change: a != null && b != null ? Math.round((b - a) * 10) / 10 : null })
  }
  const w1 = new Map(fixedResults(rows, w => w === 1).map(r => [r.key, r]))
  const w6 = new Map(fixedResults(rows, isRetestWeek).map(r => [r.key, r]))
  for (const key of new Set([...w1.keys(), ...w6.keys()])) {
    if (!GATE_FIXED_KEYS.includes(key)) continue
    const a = w1.get(key)
    const b = w6.get(key)
    const label = (a ?? b) as FixedResult
    out.push({ key, label: label.label, unit: label.unit, week1: a?.value ?? null, retest: b?.value ?? null, change: a && b ? Math.round((b.value - a.value) * 10) / 10 : null })
  }
  return out
}
