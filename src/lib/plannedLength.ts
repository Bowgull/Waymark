// Planned length of a session from its own prescription, for the done
// summary's "+N min" chip (page 33: "Done · 52 min +7 min · RPE 7"). Pure.
//
// Strength: every set's work plus the rest after it (the last set has no rest
// after it). A working set takes about 40 s, a warm-up about 25 s.
// Foundation: the routine's own estimate (lib/foundation estimateRoutineSec).
// Rounds (bag work, rope): the rounds and the rests between them.

export const WORK_SET_SEC = 40
export const WARMUP_SET_SEC = 25

export interface PlannedSet {
  isWarmup: boolean | number
  /** Rest after this set, seconds. */
  restSec: number | null | undefined
}

/** Minutes for a strength session's sets, in order (whole minutes). */
export function plannedStrengthMinutes(sets: ReadonlyArray<PlannedSet>): number | null {
  if (sets.length === 0) return null
  let sec = 0
  sets.forEach((s, i) => {
    sec += s.isWarmup === true || s.isWarmup === 1 ? WARMUP_SET_SEC : WORK_SET_SEC
    if (i < sets.length - 1) sec += Math.max(0, s.restSec ?? 0)
  })
  return Math.max(1, Math.round(sec / 60))
}

/** Minutes for timed rounds: every round, and the rest between rounds (none after the last). */
export function plannedRoundMinutes(rounds: ReadonlyArray<{ durationSec: number; restSec?: number | null }>): number | null {
  if (rounds.length === 0) return null
  const sec = rounds.reduce((t, r, i) => t + r.durationSec + (i < rounds.length - 1 ? Math.max(0, r.restSec ?? 0) : 0), 0)
  return Math.max(1, Math.round(sec / 60))
}

/**
 * Per-round actuals as the athlete did them (seconds per round, in order), as
 * stored at finish. Null when nothing was recorded (an older session).
 */
export function parseRoundSecs(raw: string | null | undefined): number[] | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) && v.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0) ? (v as number[]) : null
  } catch {
    return null
  }
}

/** Where a session's per-round seconds wait on the phone until it is finished. */
export function roundSecsKey(sessionId: string): string {
  return `waymark_round_secs:${sessionId}`
}

/** Set round `index` (0-based) to `sec`; rounds not reached stay out (the list is as long as the last round done). */
export function withRoundSec(list: ReadonlyArray<number>, index: number, sec: number): number[] {
  const next = Array.from({ length: Math.max(list.length, index + 1) }, (_, i) => list[i] ?? 0)
  next[index] = Math.max(0, Math.round(sec))
  return next
}
