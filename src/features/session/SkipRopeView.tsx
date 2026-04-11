import { useState } from 'react'

import { RestTimer } from './RestTimer'
import { useRestTimer } from './useRestTimer'

interface SkipSession {
  id: string
  roundCount: number
  roundDurSec: number
}

type SkipPhase = 'ready' | 'skipping' | 'rest'

interface SkipRopeViewProps {
  skipSession: SkipSession
  onComplete: () => void
}

function formatTime(sec: number): string {
  const abs = Math.abs(sec)
  const m = Math.floor(abs / 60)
  const s = abs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function SkipRopeView({ skipSession, onComplete }: SkipRopeViewProps) {
  const [currentRound, setCurrentRound] = useState(1)
  const [skipPhase, setSkipPhase] = useState<SkipPhase>('ready')
  const roundTimer = useRestTimer()
  const restTimer = useRestTimer()

  const totalRounds = skipSession.roundCount
  const isLastRound = currentRound >= totalRounds

  function startRound() {
    roundTimer.start(skipSession.roundDurSec)
    setSkipPhase('skipping')
  }

  function endRound() {
    roundTimer.stop()
    if (isLastRound) {
      onComplete()
    } else {
      restTimer.start(60)
      setSkipPhase('rest')
    }
  }

  function nextRound() {
    restTimer.stop()
    setCurrentRound(currentRound + 1)
    setSkipPhase('ready')
  }

  // Check if round timer hit zero
  if (skipPhase === 'skipping' && roundTimer.secondsRemaining <= 0 && roundTimer.isRunning) {
    endRound()
  }

  if (skipPhase === 'rest') {
    return (
      <div>
        <p className="text-center text-sm uppercase tracking-widest text-zinc-500">
          Round {currentRound} of {totalRounds} — Rest
        </p>
        <RestTimer
          secondsRemaining={restTimer.secondsRemaining}
          isOvertime={restTimer.isOvertime}
          onNext={nextRound}
        />
      </div>
    )
  }

  return (
    <div>
      <p className="mb-1 text-xs uppercase tracking-widest text-zinc-500">
        Round {currentRound} of {totalRounds}
      </p>
      <h2 className="text-2xl font-bold text-zinc-100">Skip Rope</h2>
      <p className="mt-2 text-sm text-zinc-400">
        Steady rhythm. Stay light on the balls of your feet. Relax your shoulders.
      </p>

      {skipPhase === 'ready' ? (
        <div className="mt-8 flex flex-col items-center">
          <p className="mb-2 text-5xl font-bold tabular-nums text-zinc-100">
            {formatTime(skipSession.roundDurSec)}
          </p>
          <p className="mb-6 text-sm text-zinc-500">Round duration</p>
          <button
            onClick={startRound}
            className="min-h-[48px] rounded-xl bg-[#1E8A68] px-8 py-3 text-base font-bold text-zinc-100 active:bg-[#4ACAAA]"
          >
            Start Round
          </button>
        </div>
      ) : (
        <div className="mt-6 flex flex-col items-center">
          <p className="mb-1 text-xs uppercase tracking-widest text-zinc-500">Time</p>
          <p className={`text-8xl font-bold tabular-nums ${
            roundTimer.secondsRemaining <= 10 ? 'text-[#C45A3C]' : 'text-zinc-100'
          }`}>
            {formatTime(roundTimer.secondsRemaining)}
          </p>
          <button
            onClick={endRound}
            className="mt-8 min-h-[44px] rounded-lg bg-zinc-800 px-6 py-2 text-sm font-medium text-zinc-400 active:bg-zinc-700"
          >
            End Round Early
          </button>
        </div>
      )}
    </div>
  )
}
