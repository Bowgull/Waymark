import { useCallback, useEffect, useRef, useState } from 'react'

interface RestTimerState {
  secondsRemaining: number
  isOvertime: boolean
  isRunning: boolean
  start: (durationSec: number) => void
  stop: () => void
}

export function useRestTimer(): RestTimerState {
  const [secondsRemaining, setSecondsRemaining] = useState(0)
  const [isRunning, setIsRunning] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  const start = useCallback((durationSec: number) => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    setSecondsRemaining(durationSec)
    setIsRunning(true)

    intervalRef.current = setInterval(() => {
      setSecondsRemaining((prev) => prev - 1)
    }, 1000)
  }, [])

  const stop = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = null
    setIsRunning(false)
    setSecondsRemaining(0)
  }, [])

  return {
    secondsRemaining,
    isOvertime: secondsRemaining < 0,
    isRunning,
    start,
    stop,
  }
}
