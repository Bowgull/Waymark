// The end gate (page 45, "BLOCK ZERO · THE GATE"): week 1 against week 6 for
// the two numbers that steer the plan (design-decisions "Block Zero tests",
// 2026-10-18): the front squat estimate (from logged sets) and the talk-test
// HR (from the run log). Then the verdict (move on / extend 1-2 weeks) with
// its reasons and one button. The rules decide and the server applies the
// decision when the check runs (POST /api/ai/block-zero-transition); this
// file only reads what came back. Pure.

import { GATE_SQUAT_ID } from '@/lib/blockZero/endGate'
import { BLOCK_ZERO_BASE_WEEKS } from '@/lib/blockZero/weeks'
import { kgToLbs } from '@/lib/units'

import { formatTestValue, type TestRowIn } from './testWeek'

/** The gate's two rows, in order. Talk-test HR is shown without a judgement (it is a ceiling, not a score). */
export const GATE_ROWS: ReadonlyArray<{ key: string; label: string; unit: string; neutral: boolean }> = [
  { key: `e1rm:${GATE_SQUAT_ID}`, label: 'Front squat · est. max', unit: 'kg', neutral: false },
  { key: 'talk_test_hr', label: 'Talk-test HR', unit: 'bpm', neutral: true },
]

export interface ComparisonRow {
  key: string
  label: string
  before: string
  after: string
  /** Both on one line, the unit once (page 45): "170 → 195 lb". */
  span: string
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

const num = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1))

/**
 * How a pair of results reads on the gate. Weights are stored in kg and shown
 * in lb (Josh measures in lb): "170 → 195 lb". Other units as the tests write them.
 */
export function shownValues(a: number, unitA: string, b: number, unitB: string): { before: string; after: string; span: string } {
  if (unitA === 'kg' && unitB === 'kg') {
    const la = kgToLbs(a)
    const lb = kgToLbs(b)
    return { before: `${la} lb`, after: `${lb} lb`, span: `${la} → ${lb} lb` }
  }
  const before = formatTestValue(a, unitA)
  const after = formatTestValue(b, unitB)
  return { before, after, span: unitA === unitB ? `${num(a)} → ${after}` : `${before} → ${after}` }
}

/**
 * Week 1 against week 6 for the two gate numbers. "Before" is week 1, or the
 * earliest week before 6 with a value (the front squat starts in week 3, so
 * its first estimate is the week-3 check set). "After" is the latest week 6+.
 * Older rows (push-ups, side plank, fixed-effort HR, scores) are not compared.
 */
export function retestComparison(rows: readonly TestRowIn[]): ComparisonRow[] {
  const out: ComparisonRow[] = []
  for (const g of GATE_ROWS) {
    const mine = rows.filter(r => r.testKey === g.key)
    const a = mine.filter(r => r.week < BLOCK_ZERO_BASE_WEEKS).sort((x, y) => x.week - y.week)[0]
    const b = mine.filter(r => r.week >= BLOCK_ZERO_BASE_WEEKS).sort((x, y) => y.week - x.week)[0]
    if (!a || !b) continue
    const diff = b.value - a.value
    const delta = g.unit === 'kg' && a.value > 0 ? `${signed((diff / a.value) * 100)}%` : signed(diff, Number.isInteger(diff) ? 0 : 1)
    const better = diff === 0 || g.neutral ? null : diff > 0
    out.push({ key: g.key, label: g.label, ...shownValues(a.value, a.unit ?? g.unit, b.value, b.unit ?? g.unit), delta, better })
  }
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

/**
 * Program's one Block Zero board (page 45): THE GATE · SEE THE VERDICT, in
 * the block's last week once the week-6 talk test from the run log is in.
 * No test-week or retest boards.
 * `rows` null (couldn't load): it shows by the week.
 */
export function gateBoardShows(viewWeek: number, currentWeek: number, totalWeeks: number, rows: readonly TestRowIn[] | null): boolean {
  if (!gateOpen(currentWeek, totalWeeks) || viewWeek !== currentWeek) return false
  if (rows == null) return true
  return rows.some(r => r.week >= BLOCK_ZERO_BASE_WEEKS && r.testKey === 'talk_test_hr')
}
