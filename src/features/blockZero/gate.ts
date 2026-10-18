// The retest + end gate moment (Block Zero Phase C, direction 7): week 1
// against the retest, the verdict (move on / extend 1-2 weeks) with its
// reasons, a primary button. The rules decide and the server applies the
// decision when the check runs (POST /api/ai/block-zero-transition); this
// file only reads what came back. Pure.

import { parseTestKey } from '@/lib/blockZero/tests'
import { BLOCK_ZERO_BASE_WEEKS } from '@/lib/blockZero/weeks'

import { GUIDED_TESTS, formatTestValue, liftNameFromId, type TestRowIn } from './testWeek'

/** Lower is better for these (same effort at a lower heart rate). Talk-test HR is shown without a judgement. */
const LOWER_IS_BETTER = new Set(['fixed_effort_hr'])
const NEUTRAL = new Set(['talk_test_hr'])

export interface ComparisonRow {
  key: string
  label: string
  before: string
  after: string
  /** "+9", "−12", "+15%". */
  delta: string
  /** true = better, false = worse, null = no judgement or no change. */
  better: boolean | null
}

function signed(n: number, digits = 0): string {
  const v = digits === 0 ? Math.round(n) : Number(n.toFixed(digits))
  if (v === 0) return '0'
  return v > 0 ? `+${v}` : `−${Math.abs(v)}`
}

/** Week 1 against the latest retest week (6 or an extension week), test by test. */
export function retestComparison(rows: readonly TestRowIn[]): ComparisonRow[] {
  const week1 = new Map<string, TestRowIn>()
  const retest = new Map<string, TestRowIn>()
  for (const r of rows) {
    if (r.week === 1) week1.set(r.testKey, r)
    else if (r.week >= BLOCK_ZERO_BASE_WEEKS) {
      const prev = retest.get(r.testKey)
      if (!prev || r.week > prev.week) retest.set(r.testKey, r)
    }
  }
  const out: ComparisonRow[] = []
  const add = (key: string, label: string, unit: string) => {
    const a = week1.get(key)
    const b = retest.get(key)
    if (!a || !b) return
    const diff = b.value - a.value
    let delta: string
    if (unit === 'kg' && a.value > 0) delta = `${signed((diff / a.value) * 100)}%`
    else delta = signed(diff, Number.isInteger(diff) ? 0 : 1)
    let better: boolean | null = null
    if (diff !== 0 && !NEUTRAL.has(key)) better = LOWER_IS_BETTER.has(key) ? diff < 0 : diff > 0
    out.push({ key, label, before: formatTestValue(a.value, a.unit ?? unit), after: formatTestValue(b.value, b.unit ?? unit), delta, better })
  }
  // Lift estimates first (the headline), then the guided tests in order.
  const lifts = [...new Set([...week1.keys(), ...retest.keys()])].filter(k => parseTestKey(k)?.kind === 'e1rm').sort()
  for (const key of lifts) {
    const parsed = parseTestKey(key)
    if (parsed?.kind === 'e1rm') add(key, `${liftNameFromId(parsed.exerciseId)} · est. max`, 'kg')
  }
  for (const t of GUIDED_TESTS) add(t.key, t.label, t.unit)
  return out
}

// ─── The verdict ──────────────────────────────────────────────

/** What POST/GET /api/ai/block-zero-transition returns (older rows lack `rules`). */
export interface TransitionResultIn {
  decision: 'proceed' | 'hold' | 'adjust'
  rationale: string
  nextBlockNotes?: string
  rules?: {
    decision: 'proceed' | 'adjust' | 'extend' | 'not_yet'
    reasons: string[]
    extendWeeks: number
    totalWeeks: number
  }
  nextBlockId?: string | null
}

export interface Verdict {
  kind: 'move_on' | 'extend' | 'not_yet'
  /** Short words for the flap. */
  title: string
  tone: 'good' | 'brass' | 'bad'
  /** The coach's line (house voice). */
  line: string
  reasons: string[]
  primaryLabel: string
}

export function verdictFor(result: TransitionResultIn): Verdict {
  const rules = result.rules
  const reasons = (rules?.reasons ?? []).filter(r => r.trim().length > 0)
  const decision = rules?.decision ?? (result.decision === 'hold' ? 'extend' : result.decision)
  if (decision === 'extend') {
    const n = Math.max(1, rules?.extendWeeks ?? 1)
    return { kind: 'extend', title: n === 1 ? 'EXTEND 1 WEEK' : `EXTEND ${n} WEEKS`, tone: 'brass', line: result.rationale, reasons, primaryLabel: 'KEEP BUILDING' }
  }
  if (decision === 'not_yet') {
    return { kind: 'not_yet', title: 'NOT YET', tone: 'brass', line: result.rationale, reasons, primaryLabel: 'BACK TO PROGRAM' }
  }
  return {
    kind: 'move_on',
    title: 'MOVE ON',
    tone: 'good',
    line: result.rationale,
    reasons,
    primaryLabel: result.nextBlockId ? 'START FIGHTER BLOCK 1' : 'TO PROGRAM',
  }
}

/** The gate opens in the block's last week (6, or the last extension week). */
export function gateOpen(currentWeek: number, totalWeeks: number): boolean {
  return currentWeek >= Math.max(BLOCK_ZERO_BASE_WEEKS, totalWeeks)
}
