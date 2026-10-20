// Coach brain P1 (coach-brain.md §4 "Confidence → caution"): one uncertainty
// mechanism for every area. u ∈ [0, 1]: 1 = GUESS, about 0.5 = LEARNING,
// about 0.15 = KNOWN, rising again by 0.1 per 7 days without data. The
// detraining prior after a gap (strength −0.5%/day after 14 days off; run rung
// −1%/day after 7 days off, to a floor) is the same idea for values. The dose
// mappings at the bottom are §4's, for P2: nothing calls them in P1. Pure.

import type { BetaCell, Confidence, EstimateState } from './types'

export const U_BY_STATE: Readonly<Record<EstimateState, number>> = { GUESS: 1, LEARNING: 0.5, KNOWN: 0.15 }
/** u rises this much per full 7 days since the last observation. */
export const U_AGE_STEP = 0.1
export const U_AGE_DAYS = 7
/** Reported state from u after ageing: under this is KNOWN, at or over GUESS_FROM is GUESS. */
export const KNOWN_BELOW = 0.3
export const GUESS_FROM = 0.9

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

export function round(v: number, dp = 2): number {
  const f = 10 ** dp
  return Math.round(v * f) / f
}

/** Weeks-of-silence ageing: +0.1 per full 7 days since the last observation. */
export function agedU(evidence: EstimateState, lastDay: number | null, today: number, extra = 0): number {
  const base = U_BY_STATE[evidence]
  if (evidence === 'GUESS') return clamp(base + extra, 0, 1)
  const days = lastDay == null ? 0 : Math.max(0, today - lastDay)
  return round(clamp(base + Math.floor(days / U_AGE_DAYS) * U_AGE_STEP + extra, 0, 1))
}

export function stateFromU(u: number): EstimateState {
  if (u >= GUESS_FROM) return 'GUESS'
  if (u < KNOWN_BELOW) return 'KNOWN'
  return 'LEARNING'
}

/** A Confidence from the evidence state, n and last day; `extra` adds to u (e.g. a run without HR). */
export function confidence(evidence: EstimateState, n: number, lastDay: number | null, today: number, opts: { extra?: number } = {}): Confidence {
  const u = agedU(evidence, lastDay, today, opts.extra ?? 0)
  return { evidence, state: stateFromU(u), n, lastDay, u }
}

// ─── Detraining prior (§4) ───────────────────────────────────

export const STRENGTH_DECAY_AFTER_DAYS = 14
export const STRENGTH_DECAY_PER_DAY = 0.005
/** Strength never decays below this share of the last estimate (a floor; the rate itself is UNVERIFIED). */
export const STRENGTH_DECAY_FLOOR = 0.6
export const RUN_DECAY_AFTER_DAYS = 7
export const RUN_DECAY_PER_DAY = 0.01

/** Multiplier for a strength estimate `daysOff` days after the last session. */
export function strengthDecay(daysOff: number): number {
  const over = Math.max(0, daysOff - STRENGTH_DECAY_AFTER_DAYS)
  return Math.max(STRENGTH_DECAY_FLOOR, 1 - over * STRENGTH_DECAY_PER_DAY)
}

/** A run rung (sec) `daysOff` days after the last run, never below `floorSec`. */
export function rungDecay(rungSec: number, daysOff: number, floorSec: number): number {
  const over = Math.max(0, daysOff - RUN_DECAY_AFTER_DAYS)
  return Math.max(floorSec, Math.round(rungSec * Math.max(0, 1 - over * RUN_DECAY_PER_DAY)))
}

// ─── Beta cells (when he trains, class nights, rest days) ────

export function betaCell(alpha: number, beta: number): BetaCell {
  return { alpha: round(alpha), beta: round(beta), n: round(alpha + beta), p: round(alpha / (alpha + beta)) }
}

/** KNOWN at ≥8 observations per cell (§4); LEARNING from 1; GUESS with none. */
export function cellState(n: number): EstimateState {
  return n >= 8 ? 'KNOWN' : n > 0 ? 'LEARNING' : 'GUESS'
}

// ─── §4 dose mappings, for P2 (not called in P1) ─────────────

/** Lifts: target RIR = base + round(1.5u); sets = base − round(u). */
export function liftDoseFromU(u: number, base: { rir: number; sets: number }): { rir: number; sets: number } {
  return { rir: base.rir + Math.round(1.5 * u), sets: Math.max(1, base.sets - Math.round(u)) }
}

/** Runs: today's run piece = rung × (1 − 0.3u). */
export function runPieceFromU(rungSec: number, u: number): number {
  return Math.round(rungSec * (1 - 0.3 * u))
}

/** Bag: rounds = tolerance × (1 − 0.3u), never above the cap. */
export function bagRoundsFromU(tolerated: number, u: number, cap: number): number {
  return Math.min(cap, Math.max(1, Math.round(tolerated * (1 - 0.3 * u))))
}
