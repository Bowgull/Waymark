import { useCallback, useEffect, useRef, useState } from 'react'

import { heavyHaptic } from '@/lib/haptics'
import {
  timerPause,
  timerRemainingMs,
  timerResume,
  timerStart,
  type TimerSnap,
} from '@/lib/sessionResume'
import { restartSnap } from '@/lib/timers/swipeBack'

export interface HoldTimerState {
  /** Seconds elapsed since start. */
  elapsed: number
  /** Is the countdown currently running. */
  running: boolean
  /** Is the countdown paused. */
  isPaused: boolean
  /** Has the elapsed time reached the target duration. */
  reachedTarget: boolean
  /** Seconds left on the clock (0 if not yet running). */
  secondsRemaining: number
  /** Wall-clock ms when this hold started (0 if not running). */
  startedAtMs: number
  /** Wall-clock ms when this hold should complete (0 if not running). */
  endsAtMs: number
}

export interface HoldTimerActions {
  /** Begin the countdown. No-op if already running. */
  start: () => void
  /** Stop the countdown (use before unmounting). */
  stop: () => void
  /** Pause the countdown. `pausedRemainingMs` (lock screen) wins over endsAt - now. */
  pause: (pausedRemainingMs?: number) => void
  /** Resume a paused countdown (an explicit end time from the Live Activity wins). */
  resume: (newEndsAtMs?: number) => void
  /** Page 85, swipe down: the hold again from its full time (paused stays paused; not started stays so). */
  restart: () => void
  /** Put a saved hold back (session resume). */
  restore: (snap: TimerSnap | null) => void
  /** The hold as it stands, for saving. */
  snapshot: () => TimerSnap | null
}

/**
 * Hold timer state + actions, split out of HoldTimer so the ring can live in
 * a session body while its Start/Done action button sits in the footer slot.
 * Wall-clock anchored (the end time is stored), never tick counted.
 */
export function useHoldTimer(targetSec: number): HoldTimerState & HoldTimerActions {
  const [snap, setSnap] = useState<TimerSnap | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const snapRef = useRef<TimerSnap | null>(null)

  const apply = useCallback((next: TimerSnap | null) => {
    snapRef.current = next
    setSnap(next)
    setNowMs(Date.now())
  }, [])

  const ticking = snap?.state === 'running'
  useEffect(() => {
    if (!ticking) return
    const id = setInterval(() => setNowMs(Date.now()), 250)
    return () => clearInterval(id)
  }, [ticking])

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') setNowMs(Date.now())
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  const start = useCallback(() => {
    if (snapRef.current) return
    apply(timerStart(targetSec, Date.now()))
  }, [apply, targetSec])

  const stop = useCallback(() => apply(null), [apply])

  const pause = useCallback((pausedRemainingMs?: number) => {
    const cur = snapRef.current
    if (!cur || cur.state !== 'running') return
    apply(timerPause(cur, Date.now(), pausedRemainingMs))
  }, [apply])

  const resume = useCallback((newEndsAtMs?: number) => {
    const cur = snapRef.current
    if (!cur || cur.state !== 'paused') return
    apply(timerResume(cur, Date.now(), newEndsAtMs))
  }, [apply])

  const restart = useCallback(() => {
    apply(restartSnap(snapRef.current, targetSec, Date.now()))
  }, [apply, targetSec])

  const restore = useCallback((next: TimerSnap | null) => apply(next), [apply])
  const snapshot = useCallback(() => snapRef.current, [])

  const remainingMs = snap ? Math.max(0, timerRemainingMs(snap, nowMs)) : targetSec * 1000
  const secondsRemaining = snap ? Math.ceil(remainingMs / 1000) : 0
  const elapsed = snap ? Math.max(0, Math.floor((targetSec * 1000 - remainingMs) / 1000)) : 0
  const running = snap != null
  const isPaused = snap?.state === 'paused'
  const reachedTarget = snap ? remainingMs <= 0 : elapsed >= targetSec
  const endsAtMs = !snap ? 0 : snap.state === 'running' ? snap.endsAtMs : nowMs + snap.remainingMs
  const startedAtMs = !snap ? 0 : snap.state === 'running' ? snap.startedAtMs : endsAtMs - targetSec * 1000

  useEffect(() => {
    if (reachedTarget && running && !isPaused) heavyHaptic()
  }, [reachedTarget, running, isPaused])

  return {
    elapsed,
    running,
    isPaused,
    reachedTarget,
    secondsRemaining,
    startedAtMs,
    endsAtMs,
    start,
    stop,
    pause,
    resume,
    restart,
    restore,
    snapshot,
  }
}
