// Page 85, swipe back on the hold and rest timers: what a swipe down does, as pure steps the
// screens share. The first swipe restarts the part from its full time; another within 3 s
// (timerLook backStep) goes to the part before, from its full time. Paused stays paused.
import { timerStart, type TimerSnap } from '../sessionResume'

import { backStep } from './timerLook'

/** Where a part's clock is: not started, running, or paused. A back keeps it so. */
export type BackRun = 'ready' | 'running' | 'paused'

export function runOf(snap: TimerSnap | null): BackRun {
  return !snap ? 'ready' : snap.state
}

/** A part from its full time, in the same run state: ready (no clock), running, or paused at full. */
export function freshSnap(run: BackRun, durationSec: number, nowMs: number): TimerSnap | null {
  if (run === 'ready') return null
  if (run === 'paused') return { state: 'paused', remainingMs: durationSec * 1000, durationSec }
  return timerStart(durationSec, nowMs)
}

/** The same part again from its full time; a part that never started stays as it is. */
export function restartSnap(snap: TimerSnap | null, durationSec: number, nowMs: number): TimerSnap | null {
  return freshSnap(runOf(snap), durationSec, nowMs)
}

/**
 * What this swipe down does. The first restarts; another within 3 s goes to the part before
 * when there is one (the first part: restart only). A part not started yet is already at its
 * full time, so there is nothing to restart: it goes straight to the part before.
 */
export function backMove(lastBackAt: number | null, nowMs: number, hasPrevious: boolean, started = true): 'restart' | 'previous' {
  if (!hasPrevious) return 'restart'
  if (!started) return 'previous'
  return backStep(lastBackAt, nowMs)
}

/** The set before this one (mobility, the Zone 2 warm-up), across exercises; null at the very first. */
export function previousSetPosition(pos: { exerciseIdx: number; setIdx: number }, setCounts: number[]): { exerciseIdx: number; setIdx: number } | null {
  if (pos.setIdx > 0) return { exerciseIdx: pos.exerciseIdx, setIdx: Math.min(pos.setIdx - 1, Math.max(0, (setCounts[pos.exerciseIdx] ?? 1) - 1)) }
  for (let e = pos.exerciseIdx - 1; e >= 0; e--) {
    const n = setCounts[e] ?? 0
    if (n > 0) return { exerciseIdx: e, setIdx: n - 1 }
  }
  return null
}

/** Active Recovery's timed parts in order: the walk, the hip holds, the rolling zones. */
export type RecoveryPart = { phase: 'walk' } | { phase: 'hip'; hipIdx: number } | { phase: 'roll'; rollIdx: number }

/**
 * The timed part before this one in Active Recovery: the hip hold before (the first hip
 * hold: the walk), the rolling step before (the first: the last hip hold). Rep moves have no
 * timer and are skipped over. Null at the walk (the first part).
 */
export function previousRecoveryPart(part: RecoveryPart, hipIsHold: boolean[]): RecoveryPart | null {
  const lastHoldBefore = (i: number): number => {
    for (let h = Math.min(i, hipIsHold.length) - 1; h >= 0; h--) if (hipIsHold[h]) return h
    return -1
  }
  if (part.phase === 'walk') return null
  if (part.phase === 'hip') {
    const h = lastHoldBefore(part.hipIdx)
    return h >= 0 ? { phase: 'hip', hipIdx: h } : { phase: 'walk' }
  }
  if (part.rollIdx > 0) return { phase: 'roll', rollIdx: part.rollIdx - 1 }
  const h = lastHoldBefore(hipIsHold.length)
  return h >= 0 ? { phase: 'hip', hipIdx: h } : { phase: 'walk' }
}
