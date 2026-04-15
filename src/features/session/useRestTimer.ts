import { useCallback, useEffect, useRef, useState } from 'react'

interface RestTimerState {
  secondsRemaining: number
  isOvertime: boolean
  isRunning: boolean
  start: (durationSec: number) => void
  stop: () => void
}

// Timestamp-based timer — survives screen lock.
// Instead of decrementing a counter, we record when the timer ends and
// calculate remaining time from the wall clock on every tick.
// When iOS unsuspends the JS thread after the screen unlocks,
// the next tick immediately snaps to the correct time.
export function useRestTimer(): RestTimerState {
  const [secondsRemaining, setSecondsRemaining] = useState(0)
  const [isRunning, setIsRunning] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const endsAtRef = useRef<number>(0) // wall-clock ms when timer expires

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  const start = useCallback((durationSec: number) => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    const endsAt = Date.now() + durationSec * 1000
    endsAtRef.current = endsAt
    setSecondsRemaining(durationSec)
    setIsRunning(true)

    intervalRef.current = setInterval(() => {
      // Calculate from wall clock, not accumulated ticks
      const remaining = Math.round((endsAtRef.current - Date.now()) / 1000)
      setSecondsRemaining(remaining)
    }, 500) // 500ms ticks for faster recovery after screen unlock
  }, [])

  const stop = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = null
    setIsRunning(false)
    setSecondsRemaining(0)
    endsAtRef.current = 0
  }, [])

  return {
    secondsRemaining,
    isOvertime: secondsRemaining < 0,
    isRunning,
    start,
    stop,
  }
}
