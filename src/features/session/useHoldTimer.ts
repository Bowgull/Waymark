import { useCallback, useEffect, useRef, useState } from 'react'

import { heavyHaptic } from '@/lib/haptics'

export interface HoldTimerState {
  /** Seconds elapsed since start. */
  elapsed: number
  /** Is the countdown currently running. */
  running: boolean
  /** Has the elapsed time reached the target duration. */
  reachedTarget: boolean
  /** Seconds left on the clock (0 if not yet running). */
  secondsRemaining: number
}

export interface HoldTimerActions {
  /** Begin the countdown. No-op if already running. */
  start: () => void
  /** Stop the countdown (use before unmounting). */
  stop: () => void
}

/**
 * Hold timer state + actions, split out of HoldTimer so the ring can live in
 * a session body while its Start/Done action button sits in the footer slot.
 */
export function useHoldTimer(targetSec: number): HoldTimerState & HoldTimerActions {
  const [elapsed, setElapsed] = useState(0)
  const [running, setRunning] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedAtRef = useRef<number>(0)

  const reachedTarget = elapsed >= targetSec
  const secondsRemaining = Math.max(0, targetSec - elapsed)

  const start = useCallback(() => {
    if (intervalRef.current) return
    startedAtRef.current = Date.now()
    setRunning(true)
    intervalRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000))
    }, 500)
  }, [])

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  useEffect(() => {
    if (reachedTarget && running) heavyHaptic()
  }, [reachedTarget, running])

  return {
    elapsed,
    running,
    reachedTarget,
    secondsRemaining,
    start,
    stop,
  }
}
