import { useCallback, useEffect, useRef, useState } from 'react'

import { RingTimer } from '@/components/RingTimer'
import { Button } from '@/components/ui/button'
import { heavyHaptic } from '@/lib/haptics'

interface HoldTimerProps {
  targetSec: number
  onDone: () => void
}

export function HoldTimer({ targetSec, onDone }: HoldTimerProps) {
  const [elapsed, setElapsed] = useState(0)
  const [running, setRunning] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const reachedTarget = elapsed >= targetSec

  const start = useCallback(() => {
    setRunning(true)
    intervalRef.current = setInterval(() => {
      setElapsed((prev) => prev + 1)
    }, 1000)
  }, [])

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  useEffect(() => {
    if (reachedTarget && running) heavyHaptic()
  }, [reachedTarget, running])

  if (!running) {
    return (
      <div className="flex flex-col items-center py-8">
        <RingTimer
          totalSeconds={targetSec}
          secondsRemaining={targetSec}
          label="Hold"
          accentColor="#4ACAAA"
        />
        <Button
          onClick={start}
          size="lg"
          className="mt-6"
          style={{ backgroundColor: '#4ACAAA' }}
        >
          Start Hold
        </Button>
      </div>
    )
  }

  const secondsRemaining = Math.max(0, targetSec - elapsed)

  return (
    <div className="flex flex-col items-center py-8">
      <RingTimer
        totalSeconds={targetSec}
        secondsRemaining={secondsRemaining}
        label={reachedTarget ? 'Done' : 'Hold'}
        accentColor="#4ACAAA"
        isComplete={reachedTarget}
      />
      <Button
        onClick={() => {
          if (intervalRef.current) clearInterval(intervalRef.current)
          onDone()
        }}
        size="lg"
        className="mt-6"
        variant={reachedTarget ? 'default' : 'secondary'}
      >
        Done
      </Button>
    </div>
  )
}
