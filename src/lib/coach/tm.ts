// Training max writes (map #8). Pure.
//
// Fighter TM progression (F2, F3, F20): a training max goes up only when the
// block's main working sets were clean (>= 90% hit the planned reps at the
// planned weight or more), there are enough of them to mean something, and
// the lift's best effort late in the block beats its early best (or what the
// plan asked for) by more than the e1RM noise threshold (~5%, F20). Anything
// else holds. Lifts with no logged sets are never bumped.

import { epley } from '../blockZero/e1rm'
import { lbText } from '../units'

export const TM_MIN_CLEAN_RATE = 0.9
export const TM_MIN_WORKING_SETS = 6
/** F20: e1RM changes under ~5% are inside the test's noise. */
export const E1RM_NOISE = 0.05
/** Fixed steps, as before: +4.54 kg lower body, +2.27 kg upper (10 / 5 lb). */
export const TM_STEP_KG = { lower: 4.54, upper: 2.27 } as const

export interface BlockWorkingSet {
  /** Training week the set was in. */
  week: number
  weightKg: number | null
  reps: number
  plannedWeightKg: number | null
  plannedReps: number | null
}

export interface TmProgressInput {
  exerciseId: string
  currentTmKg: number
  region: 'upper' | 'lower'
  sets: BlockWorkingSet[]
}

export interface TmDecision {
  exerciseId: string
  action: 'progress' | 'hold'
  currentTmKg: number
  newTmKg: number
  reason: string
}

function isClean(s: BlockWorkingSet): boolean {
  if (s.weightKg == null || !(s.weightKg > 0)) return false
  if (s.plannedReps != null && s.reps < s.plannedReps) return false
  if (s.plannedWeightKg != null && s.weightKg < s.plannedWeightKg) return false
  return true
}

function bestE1rm(sets: Array<{ weightKg: number | null; reps: number }>): number | null {
  let best: number | null = null
  for (const s of sets) {
    if (s.weightKg == null) continue
    const e = epley(s.weightKg, s.reps)
    if (e != null && (best == null || e > best)) best = e
  }
  return best
}

export function fighterTmDecision(input: TmProgressInput): TmDecision {
  const hold = (reason: string): TmDecision => ({ exerciseId: input.exerciseId, action: 'hold', currentTmKg: input.currentTmKg, newTmKg: input.currentTmKg, reason })
  const sets = input.sets.filter(s => s.reps >= 0)
  if (sets.length < TM_MIN_WORKING_SETS) return hold(`${sets.length} working sets logged. Not enough to move the max. It holds.`)
  const clean = sets.filter(isClean)
  const rate = clean.length / sets.length
  if (rate < TM_MIN_CLEAN_RATE) return hold(`${Math.round(rate * 100)}% of sets were clean. The max holds.`)

  const weeks = sets.map(s => s.week)
  const last = Math.max(...weeks)
  const first = Math.min(...weeks)
  const recent = clean.filter(s => s.week > last - 3)
  const early = clean.filter(s => s.week < first + 3 && s.week <= last - 3)
  const evidence = bestE1rm(recent)
  // Early in the block when it exists; otherwise what the plan asked for.
  const baseline = early.length > 0
    ? bestE1rm(early)
    : bestE1rm(recent.map(s => ({ weightKg: s.plannedWeightKg ?? s.weightKg, reps: s.plannedReps ?? s.reps })))
  if (evidence == null || baseline == null) return hold('No set in the 1-10 rep range. The max holds.')
  const change = (evidence - baseline) / baseline
  if (change <= E1RM_NOISE) return hold(`Best effort moved ${Math.round(change * 1000) / 10}%. That is inside the noise. The max holds.`)

  const step = TM_STEP_KG[input.region]
  const newTmKg = Math.round((input.currentTmKg + step) * 100) / 100
  return {
    exerciseId: input.exerciseId,
    action: 'progress',
    currentTmKg: input.currentTmKg,
    newTmKg,
    reason: `Clean block and best effort up ${Math.round(change * 100)}%. Max up ${lbText(step)}.`,
  }
}

// ─── Block Zero training max writes ───────────────────────────

export interface TmWriteCandidate {
  exerciseId: string
  weightKg: number
  source: 'ai' | 'retest'
}

/**
 * Block Zero transition writes (map #8): only when moving on (proceed or
 * adjust). A lift without a retest keeps its current max: an AI number is
 * capped at the current max, and dropped when there is none. Retest-backed
 * numbers are capped later by the retest rule (guardCalibrationWrites).
 */
export function transitionTmWrites(
  decision: 'proceed' | 'adjust' | 'extend' | 'not_yet',
  candidates: TmWriteCandidate[],
  retested: ReadonlySet<string>,
  currentTms: ReadonlyMap<string, number>,
): TmWriteCandidate[] {
  if (decision !== 'proceed' && decision !== 'adjust') return []
  const out: TmWriteCandidate[] = []
  for (const c of candidates) {
    if (!(c.weightKg > 0)) continue
    if (retested.has(c.exerciseId)) { out.push(c); continue }
    const current = currentTms.get(c.exerciseId)
    if (current == null) continue
    out.push({ ...c, weightKg: Math.min(c.weightKg, current) })
  }
  return out
}

// ─── Training max proposal (plan §6) ──────────────────────────
//
// At a block end or retest the rule-based decisions become one question: old
// -> new per lift. The athlete may adjust each new value within the rule's
// bounds (never below the current max, never above what the rule allows),
// approve, or keep the old ones. Accept writes; reject keeps. Pure.

/** Client steps in 2.5 lb (1.13 kg). */
export const TM_ADJUST_STEP_KG = 1.13

export interface TmProposalLift {
  exerciseId: string
  name: string
  currentKg: number
  proposedKg: number
  /** Bounds for the athlete's adjustment. */
  minKg: number
  maxKg: number
  stepKg: number
  reason: string
}

export interface TmProposal {
  question: string
  lifts: TmProposalLift[]
  /** Lifts that hold, with why. Shown, not asked. */
  holds: Array<{ exerciseId: string; name: string; currentKg: number; reason: string }>
  options: [{ kind: 'tm_update'; id: 'approve'; title: 'APPROVE'; label: string; lifts: TmProposalLift[] }]
  decline: { id: 'keep_old'; title: 'KEEP THE OLD ONES' }
}

export function tmProposal(decisions: TmDecision[], names: ReadonlyMap<string, string>): TmProposal | null {
  const lifts: TmProposalLift[] = decisions.filter(d => d.action === 'progress').map(d => ({
    exerciseId: d.exerciseId,
    name: names.get(d.exerciseId) ?? d.exerciseId,
    currentKg: d.currentTmKg,
    proposedKg: d.newTmKg,
    minKg: d.currentTmKg,
    maxKg: d.newTmKg,
    stepKg: TM_ADJUST_STEP_KG,
    reason: d.reason,
  }))
  if (lifts.length === 0) return null
  const holds = decisions.filter(d => d.action === 'hold').map(d => ({ exerciseId: d.exerciseId, name: names.get(d.exerciseId) ?? d.exerciseId, currentKg: d.currentTmKg, reason: d.reason }))
  const what = lifts.map(l => l.name).join(', ')
  return {
    question: `The block is done and ${lifts.length === 1 ? 'one lift' : `${lifts.length} lifts`} moved past the noise. New training maxes for ${what}?`,
    lifts,
    holds,
    options: [{ kind: 'tm_update', id: 'approve', title: 'APPROVE', label: `New maxes for ${what}`, lifts }],
    decline: { id: 'keep_old', title: 'KEEP THE OLD ONES' },
  }
}

/**
 * The values to write on accept: the athlete's per-lift values when given,
 * each clamped to its bounds; lifts not given take the proposal.
 */
export function tmAcceptValues(lifts: TmProposalLift[], chosen: Record<string, number> | null | undefined): Array<{ exerciseId: string; weightKg: number; clamped: boolean }> {
  return lifts.map(l => {
    const raw = chosen?.[l.exerciseId]
    const want = typeof raw === 'number' && Number.isFinite(raw) ? raw : l.proposedKg
    const weightKg = Math.round(Math.min(l.maxKg, Math.max(l.minKg, want)) * 100) / 100
    return { exerciseId: l.exerciseId, weightKg, clamped: weightKg !== Math.round(want * 100) / 100 }
  })
}
