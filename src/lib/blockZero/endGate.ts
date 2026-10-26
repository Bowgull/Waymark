// Block Zero history helpers (completion, gaps, back trend, e1RMs from sets)
// and the hand-off constants. The end gate itself (evaluateEndGate, its 1-2
// week extensions and the transition plan) is gone: readiness for the next
// block is four parts with no fixed length (coach-brain.md §8,
// lib/brain/readinessParts.ts), and the move is set by the nightly pass
// (server/readiness.ts) as a Monday rune with UNDO.

import { e1rmFromRir, epley } from './e1rm'
import { BLOCK_ZERO_BASE_WEEKS } from './weeks'
import { KEY_TYPES } from '../keyTypes'

export const MIN_COMPLETION_RATE = 0.7
export const MAX_RECENT_GAP_DAYS = 7
/**
 * How far back "recent" reaches for gaps: the back half of the block (weeks
 * 4-6 at the week-6 gate). A 14-day window misses a week-4 gap entirely.
 */
export const RECENT_GAP_WINDOW_DAYS = 21

export type BackTrend = 'better' | 'stable' | 'worse' | 'unknown'

// ─── Gate inputs from raw history (pure) ──────────────────────

/** Session types that count toward consistency (lib/keyTypes). Foundation is a habit, not a training dose. */
export const KEY_SESSION_TYPES = KEY_TYPES

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

// ─── The hand-off ─────────────────────────────────────────────

/** Fighter default length, as POST /api/blocks creates it. */
export const FIGHTER_DEFAULT_TOTAL_WEEKS = 12
/**
 * After Block Zero (rebuild Phase 2): the same one plan goes on as build
 * weeks, never the old Fighter week. The name the move's lines use.
 */
export const NEXT_BLOCK_NAME = 'The Campaign'
/** The rune's word for it. */
export const NEXT_BLOCK_SHOW = 'THE CAMPAIGN'
