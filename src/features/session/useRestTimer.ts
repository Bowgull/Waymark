import { useCallback, useEffect, useRef, useState } from 'react'

interface RestTimerState {
  secondsRemaining: number
  isOvertime: boolean
  isRunning: boolean
  isPaused: boolean
  startedAtMs: number
  endsAtMs: number
  start: (durationSec: number) => void
  stop: () => void
  pause: () => void
  /** Resume with remaining time from pause (or an explicit new endsAt from Live Activity). */
  resume: (newEndsAtMs?: number) => void
}

// Timestamp-based timer — survives screen lock.
// Instead of decrementing a counter, we record when the timer ends and
// calculate remaining time from the wall clock on every tick.
// When iOS unsuspends the JS thread after the screen unlocks,
// the next tick immediately snaps to the correct time.
export function useRestTimer(): RestTimerState {
  const [secondsRemaining, setSecondsRemaining] = useState(0)
  const [isRunning, setIsRunning] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [startedAtMs, setStartedAtMs] = useState(0)
  const [endsAtMs, setEndsAtMs] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const endsAtRef = useRef<number>(0) // wall-clock ms when timer expires
  const pausedRemainingRef = useRef<number>(0)

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  const startTicking = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(() => {
      const remaining = Math.round((endsAtRef.current - Date.now()) / 1000)
      setSecondsRemaining(remaining)
    }, 500)
  }, [])

  const start = useCallback((durationSec: number) => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    const now = Date.now()
    const endsAt = now + durationSec * 1000
    endsAtRef.current = endsAt
    setStartedAtMs(now)
    setEndsAtMs(endsAt)
    setSecondsRemaining(durationSec)
    setIsRunning(true)
    setIsPaused(false)
    startTicking()
  }, [startTicking])

  const stop = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = null
    setIsRunning(false)
    setIsPaused(false)
    setSecondsRemaining(0)
    setStartedAtMs(0)
    setEndsAtMs(0)
    endsAtRef.current = 0
    pausedRemainingRef.current = 0
  }, [])

  const pause = useCallback(() => {
    if (!isRunning || isPaused) return
    const remainingMs = Math.max(0, endsAtRef.current - Date.now())
    pausedRemainingRef.current = remainingMs
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = null
    setIsPaused(true)
    setSecondsRemaining(Math.round(remainingMs / 1000))
  }, [isRunning, isPaused])

  const resume = useCallback((newEndsAtMs?: number) => {
    if (!isRunning) return
    const now = Date.now()
    const endsAt = newEndsAtMs ?? now + pausedRemainingRef.current
    endsAtRef.current = endsAt
    setStartedAtMs(now)
    setEndsAtMs(endsAt)
    setIsPaused(false)
    setSecondsRemaining(Math.round((endsAt - now) / 1000))
    startTicking()
  }, [isRunning, startTicking])

  return {
    secondsRemaining,
    isOvertime: secondsRemaining < 0,
    isRunning,
    isPaused,
    startedAtMs,
    endsAtMs,
    start,
    stop,
    pause,
    resume,
  }
}
