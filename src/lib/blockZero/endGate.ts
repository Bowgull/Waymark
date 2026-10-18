// Block Zero end gate and transition plan. Rules set the limits; the AI
// decision can only be more cautious inside them, never override them.
//
// Proceed needs: key-session completion >= ~70%, no 7+ day gap recently, the
// back stable or better, and the week-6 numbers in. Otherwise extend, at most
// 2 extensions (8 weeks). At the limit it proceeds with conservative loads.
//
// No test week (2026-10-18): the "retest" is two numbers only. The front squat
// estimate comes silently from logged sets (week 5 and 6 sets, extension weeks
// too); the talk-test HR comes from the run log on the first easy run-walk of
// week 6. Either one counts as the retest being in. The other lifts' training
// maxes still come from their logged sets.

import { e1rmFromRir, epley } from './e1rm'
import { isFighterMainLift } from './lifts'
import { BLOCK_ZERO_BASE_WEEKS, BLOCK_ZERO_MAX_EXTENSIONS } from './weeks'
import { transitionTmWrites } from '../coach/tm'

export const MIN_COMPLETION_RATE = 0.7
export const MAX_RECENT_GAP_DAYS = 7
/**
 * How far back "recent" reaches for gaps: the back half of the block (weeks
 * 4-6 at the week-6 gate). A 14-day window misses a week-4 gap entirely.
 */
export const RECENT_GAP_WINDOW_DAYS = 21

export type BackTrend = 'better' | 'stable' | 'worse' | 'unknown'

export interface EndGateInput {
  /** 0-1, key sessions only. Null = nothing due yet. */
  completionRate: number | null
  longestRecentGapDays: number
  backTrend: BackTrend
  retestDone: boolean
  extensionsUsed: number
}

export interface EndGateResult {
  decision: 'proceed' | 'extend'
  /** Weeks to add. 0 on proceed. */
  extendWeeks: number
  /** True when proceeding only because extensions ran out. */
  forced: boolean
  reasons: string[]
}

export function evaluateEndGate(input: EndGateInput): EndGateResult {
  const remaining = Math.max(0, BLOCK_ZERO_MAX_EXTENSIONS - input.extensionsUsed)
  const reasons: string[] = []
  let severe = false

  if (input.completionRate == null) {
    reasons.push('No sessions logged yet.')
    severe = true
  } else if (input.completionRate < MIN_COMPLETION_RATE) {
    reasons.push(`${Math.round(input.completionRate * 100)}% of sessions done. The floor is ${Math.round(MIN_COMPLETION_RATE * 100)}%.`)
    if (input.completionRate < 0.5) severe = true
  }
  if (input.longestRecentGapDays >= MAX_RECENT_GAP_DAYS) {
    reasons.push(`A ${input.longestRecentGapDays}-day gap in the last ${RECENT_GAP_WINDOW_DAYS / 7} weeks.`)
    if (input.longestRecentGapDays >= 14) severe = true
  }
  if (input.backTrend === 'worse') reasons.push('The back is trending worse.')
  if (!input.retestDone) reasons.push('No week-6 talk test yet. Log it on an easy run.')

  if (reasons.length === 0) {
    return { decision: 'proceed', extendWeeks: 0, forced: false, reasons: ['Consistency, back and the week-6 numbers are in. Move on.'] }
  }
  if (remaining === 0) {
    return { decision: 'proceed', extendWeeks: 0, forced: true, reasons: [...reasons, 'Two extensions used. Moving on with conservative loads.'] }
  }
  return { decision: 'extend', extendWeeks: Math.min(severe ? 2 : 1, remaining), forced: false, reasons }
}

// ─── Gate inputs from raw history (pure) ──────────────────────

/** Session types that count toward consistency. Foundation is a habit, not a training dose. */
export const KEY_SESSION_TYPES = new Set(['strength', 'foundation_run', 'running', 'skip_rope', 'bag_work', 'mt_class'])

export interface GateSession {
  type: string
  status: string
  scheduledDate: number | null
  completedAt?: number | null
}

/** completed / (completed + missed + skipped + planned-but-past), key sessions only. */
export function keySessionCompletionRate(sessions: GateSession[], todayEpochDay: number): number | null {
  let due = 0
  let done = 0
  for (const s of sessions) {
    if (!KEY_SESSION_TYPES.has(s.type) || s.scheduledDate == null) continue
    if (s.status === 'completed') { due++; done++; continue }
    if (s.status === 'missed' || s.status === 'skipped') { due++; continue }
    if (s.status === 'planned' && s.scheduledDate < todayEpochDay) due++
  }
  return due === 0 ? null : done / due
}

/**
 * Longest run of days with no completed key session that overlaps the window
 * [today - windowDays + 1, today]. `completedDays` are epoch days.
 * `startEpochDay` bounds the first gap so the block start isn't a gap.
 */
export function longestGapInWindow(completedDays: number[], todayEpochDay: number, startEpochDay: number, windowDays = RECENT_GAP_WINDOW_DAYS): number {
  const windowStart = todayEpochDay - windowDays + 1
  const days = [...new Set(completedDays)].filter(d => d >= startEpochDay && d <= todayEpochDay).sort((a, b) => a - b)
  const anchors = [startEpochDay - 1, ...days, todayEpochDay + 1]
  let longest = 0
  for (let i = 1; i < anchors.length; i++) {
    const gapStart = anchors[i - 1] + 1
    const gapEnd = anchors[i] - 1
    if (gapEnd < gapStart) continue
    if (gapEnd < windowStart) continue
    // A gap still open at the block's first day is the start, not a lapse.
    if (i === 1 && days.length > 0) continue
    longest = Math.max(longest, gapEnd - gapStart + 1)
  }
  return longest
}

/**
 * Back trend from "back today" scores (1-5, higher = better): the last 7 days
 * against the block's first 7. Half a point either way counts.
 */
export function backTrend(scores: Array<{ epochDay: number; backToday: number | null | undefined }>, startEpochDay: number, todayEpochDay: number): BackTrend {
  const first = scores.filter(s => s.backToday != null && s.epochDay >= startEpochDay && s.epochDay < startEpochDay + 7).map(s => s.backToday as number)
  const last = scores.filter(s => s.backToday != null && s.epochDay > todayEpochDay - 7 && s.epochDay <= todayEpochDay).map(s => s.backToday as number)
  if (first.length < 3 || last.length < 3) return 'unknown'
  const diff = last.reduce((a, b) => a + b, 0) / last.length - first.reduce((a, b) => a + b, 0) / first.length
  if (diff >= 0.5) return 'better'
  if (diff <= -0.5) return 'worse'
  return 'stable'
}

// ─── Retest → training max ────────────────────────────────────

/** The squat the gate reads (the main squat is the front squat; goblet in weeks 1-2). */
export const GATE_SQUAT_ID = 'ex-front-squat'

/** Strength weeks whose logged sets give the week-6 estimates: week 5 (and the extension weeks that repeat it) and week 6. */
export function isRetestSetWeek(blockWeek: number | null | undefined): boolean {
  return blockWeek != null && blockWeek >= BLOCK_ZERO_BASE_WEEKS - 1
}

/**
 * "Retest done": the week-6 (or later) talk-test HR from the run log. The
 * front squat estimate always exists from logged sets, so it never gates
 * (owner decision, design-decisions.md "Block Zero tests").
 */
export function retestDoneFrom(_e1rms: ReadonlyMap<string, number>, talkTestWeeks: readonly number[]): boolean {
  return talkTestWeeks.some(w => w >= BLOCK_ZERO_BASE_WEEKS)
}

export interface RetestSet {
  exerciseId: string
  weightKg: number | null
  reps: number
  /** Reps left in the tank, when logged: the estimate uses reps + RIR. */
  rir?: number | null
}

/**
 * Best e1RM per lift from retest sets (reps 1-10 only). With RIR logged it is
 * reps + RIR to failure (R4); past 10 that way, or with no RIR, plain Epley
 * on the reps done, which errs low.
 */
export function retestE1rms(sets: RetestSet[]): Map<string, number> {
  const best = new Map<string, number>()
  for (const s of sets) {
    if (s.weightKg == null) continue
    const e = (s.rir != null ? e1rmFromRir(s.weightKg, s.reps, s.rir) : null) ?? epley(s.weightKg, s.reps)
    if (e == null) continue
    if (e > (best.get(s.exerciseId) ?? 0)) best.set(s.exerciseId, e)
  }
  return best
}

/**
 * Training max from an e1RM. The Fighter waves run 75-90% of TM for 5s and 3s,
 * so TM sits at 90% of e1RM; an adjust decision drops it to 85%.
 */
export const TM_FROM_E1RM = 0.9
export const TM_FROM_E1RM_ADJUST = 0.85

function roundHalf(kg: number): number {
  return Math.round(kg * 2) / 2
}

// ─── Transition plan ──────────────────────────────────────────

export type AiDecision = 'proceed' | 'hold' | 'adjust'

export interface TransitionInput {
  gate: EndGateInput
  aiDecision: AiDecision | null
  aiTargets: Array<{ exerciseId: string; estimatedMaxKg: number }>
  retestE1rms: Map<string, number>
  totalWeeks: number
  /** False before the block's last week: nothing is extended early. */
  atEndBoundary: boolean
  /** Current training maxes. A lift without a retest keeps its max (map #8). */
  currentTms?: ReadonlyMap<string, number>
}

export interface CalibrationWrite {
  exerciseId: string
  weightKg: number
  source: 'ai' | 'retest'
}

export interface NextBlockSpec {
  name: string
  blockType: 'fighter'
  totalWeeks: number
}

/** Fighter default length, as POST /api/blocks creates it. */
export const FIGHTER_DEFAULT_TOTAL_WEEKS = 12
export const NEXT_BLOCK_NAME = 'Fighter Block 1'

export interface TransitionPlan {
  decision: 'proceed' | 'adjust' | 'extend' | 'not_yet'
  /** What the stored output reports (the UI reads proceed | hold | adjust). */
  reportedDecision: AiDecision
  extendWeeks: number
  newTotalWeeks: number
  nextBlock: NextBlockSpec | null
  calibration: CalibrationWrite[]
  gate: EndGateResult
  reasons: string[]
}

/**
 * Combine the gate and the AI. The gate's extend always wins. On a gate
 * proceed the AI may still hold (more cautious) while extensions remain, or
 * turn proceed into adjust. Forced proceed after 2 extensions is an adjust.
 */
export function planTransition(input: TransitionInput): TransitionPlan {
  const gate = evaluateEndGate(input.gate)
  const remaining = Math.max(0, BLOCK_ZERO_MAX_EXTENSIONS - input.gate.extensionsUsed)

  let decision: TransitionPlan['decision']
  let extendWeeks = 0
  const reasons = [...gate.reasons]
  if (gate.decision === 'extend') {
    decision = 'extend'
    extendWeeks = gate.extendWeeks
    if (input.aiDecision === 'proceed' || input.aiDecision === 'adjust') reasons.push('The coach said move on. The rules hold the line.')
  } else if (gate.forced) {
    decision = 'adjust'
  } else if (input.aiDecision === 'hold' && remaining > 0) {
    decision = 'extend'
    extendWeeks = 1
    reasons.push('The coach wants one more week.')
  } else if (input.aiDecision === 'adjust') {
    decision = 'adjust'
  } else {
    decision = 'proceed'
  }

  if (decision === 'extend' && !input.atEndBoundary) {
    decision = 'not_yet'
    extendWeeks = 0
    reasons.push('Not at the end of the block yet. Nothing changes.')
  }

  // Training maxes are written only when moving on (map #8): never on extend
  // or not_yet. AI targets for a retested lift are capped later by the retest
  // rule; a lift without a retest keeps its current max (capped at it, dropped
  // when there is none). Retest-derived maxes fill the lifts the AI left out.
  const movingOn = decision === 'proceed' || decision === 'adjust'
  const calibration: CalibrationWrite[] = []
  const covered = new Set<string>()
  const aiWrites = transitionTmWrites(
    decision,
    input.aiTargets.filter(t => t.exerciseId).map(t => ({ exerciseId: t.exerciseId, weightKg: t.estimatedMaxKg, source: 'ai' as const })),
    new Set(input.retestE1rms.keys()),
    input.currentTms ?? new Map(),
  )
  for (const w of aiWrites) {
    calibration.push(w)
    covered.add(w.exerciseId)
  }
  for (const t of input.aiTargets) if (t.exerciseId) covered.add(t.exerciseId)
  if (movingOn) {
    const factor = decision === 'adjust' ? TM_FROM_E1RM_ADJUST : TM_FROM_E1RM
    for (const [exerciseId, e1rm] of input.retestE1rms) {
      if (covered.has(exerciseId) || !isFighterMainLift(exerciseId)) continue
      calibration.push({ exerciseId, weightKg: roundHalf(e1rm * factor), source: 'retest' })
    }
  }

  const reportedDecision: AiDecision = decision === 'extend' || decision === 'not_yet' ? 'hold' : decision
  return {
    decision,
    reportedDecision,
    extendWeeks,
    newTotalWeeks: input.totalWeeks + extendWeeks,
    nextBlock: movingOn ? { name: NEXT_BLOCK_NAME, blockType: 'fighter', totalWeeks: FIGHTER_DEFAULT_TOTAL_WEEKS } : null,
    calibration,
    gate,
    reasons,
  }
}
