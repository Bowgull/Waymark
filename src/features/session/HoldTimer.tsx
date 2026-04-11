import { useCallback, useEffect, useRef, useState } from 'react'

interface HoldTimerProps {
  targetSec: number
  onDone: () => void
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
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

  if (!running) {
    return (
      <div className="flex flex-col items-center py-8">
        <p className="mb-2 text-5xl font-bold tabular-nums text-zinc-100">
          {formatTime(targetSec)}
        </p>
        <p className="mb-6 text-sm text-zinc-500">Hold target</p>
        <button
          onClick={start}
          className="min-h-[48px] rounded-xl bg-[#4ACAAA] px-8 py-3 text-base font-bold text-zinc-950 active:bg-[#1E8A68]"
        >
          Start Hold
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center py-8">
      <p className="mb-1 text-xs uppercase tracking-widest text-zinc-500">
        {reachedTarget ? 'Target reached' : 'Hold'}
      </p>
      <p
        className={`text-8xl font-bold tabular-nums ${
          reachedTarget ? 'text-[#4ACAAA]' : 'text-zinc-100'
        }`}
      >
        {formatTime(elapsed)}
      </p>
      <p className="mt-1 text-sm text-zinc-500">/ {formatTime(targetSec)}</p>
      <button
        onClick={() => {
          if (intervalRef.current) clearInterval(intervalRef.current)
          onDone()
        }}
        className={`mt-6 min-h-[48px] rounded-xl px-8 py-3 text-base font-bold ${
          reachedTarget
            ? 'bg-[#E8C860] text-zinc-950 active:bg-[#C8A030]'
            : 'bg-zinc-800 text-zinc-400 active:bg-zinc-700'
        }`}
      >
        Done
      </button>
    </div>
  )
}
