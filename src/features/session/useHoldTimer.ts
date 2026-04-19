import { useCallback, useEffect, useRef, useState } from 'react'

import { heavyHaptic } from '@/lib/haptics'

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
  /** Pause the countdown. Elapsed freezes until resume. */
  pause: () => void
  /** Resume a paused countdown. */
  resume: () => void
}

/**
 * Hold timer state + actions, split out of HoldTimer so the ring can live in
 * a session body while its Start/Done action button sits in the footer slot.
 */
export function useHoldTimer(targetSec: number): HoldTimerState & HoldTimerActions {
  const [elapsed, setElapsed] = useState(0)
  const [running, setRunning] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [startedAtMs, setStartedAtMs] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedAtRef = useRef<number>(0)
  const pausedElapsedRef = useRef<number>(0)

  const reachedTarget = elapsed >= targetSec
  const secondsRemaining = Math.max(0, targetSec - elapsed)
  const endsAtMs = startedAtMs > 0 ? startedAtMs + targetSec * 1000 : 0

  const startTicking = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000))
    }, 500)
  }, [])

  const start = useCallback(() => {
    if (intervalRef.current) return
    const now = Date.now()
    startedAtRef.current = now
    setStartedAtMs(now)
    setRunning(true)
    setIsPaused(false)
    pausedElapsedRef.current = 0
    startTicking()
  }, [startTicking])

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const pause = useCallback(() => {
    if (!running || isPaused) return
    pausedElapsedRef.current = Math.floor((Date.now() - startedAtRef.current) / 1000)
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    setIsPaused(true)
  }, [running, isPaused])

  const resume = useCallback(() => {
    if (!running || !isPaused) return
    startedAtRef.current = Date.now() - pausedElapsedRef.current * 1000
    setStartedAtMs(startedAtRef.current)
    setIsPaused(false)
    startTicking()
  }, [running, isPaused, startTicking])

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

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
  }
}
