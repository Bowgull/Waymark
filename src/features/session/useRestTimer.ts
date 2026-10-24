import { useCallback, useEffect, useRef, useState } from 'react'

import {
  timerPause,
  timerRemainingMs,
  timerResume,
  timerStart,
  timerStartAt,
  type TimerSnap,
} from '@/lib/sessionResume'
import { restartSnap } from '@/lib/timers/swipeBack'

interface RestTimerState {
  secondsRemaining: number
  isOvertime: boolean
  isRunning: boolean
  isPaused: boolean
  startedAtMs: number
  endsAtMs: number
  /** Length of the current countdown (for the ring). */
  durationSec: number
  start: (durationSec: number) => void
  /** Start a countdown that began at `startMs` (e.g. a rest that starts when the round ended). */
  startFrom: (startMs: number, durationSec: number) => void
  stop: () => void
  /** Pause. `pausedRemainingMs` (from the lock screen) wins over endsAt - now. */
  pause: (pausedRemainingMs?: number) => void
  /** Resume with remaining time from pause (or an explicit new endsAt from Live Activity).
   *  Returns the wall-clock ms when the timer will expire, for precise notification scheduling. */
  resume: (newEndsAtMs?: number) => number
  /** Page 85, swipe down: the same countdown again from its full length (paused stays paused).
   *  Returns the new wall-clock end while running (0 paused or stopped), for the notification. */
  restart: () => number
  /** Put a saved timer back (session resume). */
  restore: (snap: TimerSnap | null) => void
  /** The timer as it stands, for saving. */
  snapshot: () => TimerSnap | null
}

// Timestamp-based timer: the snapshot holds the END time (or, paused, what is
// left), and the remaining time is computed from the wall clock on every
// tick and on every return to the foreground. No tick counting, so a locked
// screen or a suspended WebView never drifts.
export function useRestTimer(): RestTimerState {
  const [snap, setSnap] = useState<TimerSnap | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const snapRef = useRef<TimerSnap | null>(null)

  const apply = useCallback((next: TimerSnap | null) => {
    snapRef.current = next
    setSnap(next)
    setNowMs(Date.now())
  }, [])

  const running = snap?.state === 'running'
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNowMs(Date.now()), 250)
    return () => clearInterval(id)
  }, [running])

  // Back from the background or a lock: snap to the real time at once.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') setNowMs(Date.now())
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [])

  const start = useCallback((durationSec: number) => {
    apply(timerStart(durationSec, Date.now()))
  }, [apply])

  const startFrom = useCallback((startMs: number, durationSec: number) => {
    apply(timerStartAt(startMs, durationSec))
  }, [apply])

  const stop = useCallback(() => apply(null), [apply])

  const pause = useCallback((pausedRemainingMs?: number) => {
    const cur = snapRef.current
    if (!cur || cur.state !== 'running') return
    apply(timerPause(cur, Date.now(), pausedRemainingMs))
  }, [apply])

  const resume = useCallback((newEndsAtMs?: number): number => {
    const cur = snapRef.current
    if (!cur) return 0
    const next = timerResume(cur, Date.now(), newEndsAtMs)
    apply(next)
    return next.state === 'running' ? next.endsAtMs : 0
  }, [apply])

  const restart = useCallback((): number => {
    const cur = snapRef.current
    if (!cur) return 0
    const next = restartSnap(cur, cur.durationSec, Date.now())
    apply(next)
    return next?.state === 'running' ? next.endsAtMs : 0
  }, [apply])

  const restore = useCallback((next: TimerSnap | null) => apply(next), [apply])
  const snapshot = useCallback(() => snapRef.current, [])

  const secondsRemaining = snap ? Math.round(timerRemainingMs(snap, nowMs) / 1000) : 0

  return {
    secondsRemaining,
    isOvertime: secondsRemaining < 0,
    isRunning: snap != null,
    isPaused: snap?.state === 'paused',
    // Paused: the end the clock would reach if resumed at the moment of pause
    // (stable, since nothing ticks while paused). The Live Activity needs a date.
    startedAtMs: !snap ? 0 : snap.state === 'running' ? snap.startedAtMs : nowMs + snap.remainingMs - snap.durationSec * 1000,
    endsAtMs: !snap ? 0 : snap.state === 'running' ? snap.endsAtMs : nowMs + snap.remainingMs,
    durationSec: snap?.durationSec ?? 0,
    start,
    startFrom,
    stop,
    pause,
    resume,
    restart,
    restore,
    snapshot,
  }
}
