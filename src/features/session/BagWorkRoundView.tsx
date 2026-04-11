import { useEffect } from 'react'

import { RestTimer } from './RestTimer'
import { useRestTimer } from './useRestTimer'

interface ComboData {
  id: string
  orderIndex: number
  combo: { id: string; text: string; tier: string; level: string } | null
}

interface RoundData {
  id: string
  roundNumber: number
  durationSec: number
  restSec: number
  combos: ComboData[]
}

type RoundPhase = 'ready' | 'fighting' | 'rest'

interface BagWorkRoundViewProps {
  round: RoundData
  totalRounds: number
  phase: RoundPhase
  onPhaseChange: (phase: RoundPhase) => void
  onNextRound: () => void
  onComplete: () => void
}

function formatTime(sec: number): string {
  const abs = Math.abs(sec)
  const m = Math.floor(abs / 60)
  const s = abs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function RoundTimer({
  secondsRemaining,
  isOvertime,
  onTimerEnd,
}: {
  secondsRemaining: number
  isOvertime: boolean
  onTimerEnd: () => void
}) {
  useEffect(() => {
    if (secondsRemaining === 0 && !isOvertime) {
      onTimerEnd()
    }
  }, [secondsRemaining, isOvertime, onTimerEnd])

  return (
    <div className="mt-6 flex flex-col items-center">
      <p className="mb-1 text-xs uppercase tracking-widest text-zinc-500">
        {isOvertime ? 'Over' : 'Time'}
      </p>
      <p
        className={`text-8xl font-bold tabular-nums ${
          isOvertime ? 'text-[#C45A3C]' : secondsRemaining <= 10 ? 'text-[#C45A3C]' : 'text-zinc-100'
        }`}
      >
        {isOvertime && '+'}
        {formatTime(secondsRemaining)}
      </p>
    </div>
  )
}

export function BagWorkRoundView({
  round,
  totalRounds,
  phase,
  onPhaseChange,
  onNextRound,
  onComplete,
}: BagWorkRoundViewProps) {
  const roundTimer = useRestTimer()
  const restTimer = useRestTimer()

  const isLastRound = round.roundNumber >= totalRounds

  function handleStartRound() {
    roundTimer.start(round.durationSec)
    onPhaseChange('fighting')
  }

  function handleRoundEnd() {
    roundTimer.stop()
    if (isLastRound) {
      onComplete()
    } else {
      restTimer.start(round.restSec)
      onPhaseChange('rest')
    }
  }

  function handleRestDone() {
    restTimer.stop()
    onNextRound()
  }

  // ─── Rest phase ────────────────────────────────────────────

  if (phase === 'rest') {
    return (
      <div>
        <p className="text-center text-sm uppercase tracking-widest text-zinc-500">
          Round {round.roundNumber} of {totalRounds} — Rest
        </p>
        <RestTimer
          secondsRemaining={restTimer.secondsRemaining}
          isOvertime={restTimer.isOvertime}
          onNext={handleRestDone}
        />
      </div>
    )
  }

  // ─── Ready + Fighting phases ───────────────────────────────

  return (
    <div>
      <p className="mb-1 text-xs uppercase tracking-widest text-zinc-500">
        Round {round.roundNumber} of {totalRounds}
      </p>

      {/* Combo card */}
      <div className="mt-4 rounded-xl border border-zinc-800 border-l-4 border-l-[#E8C860] bg-zinc-900 p-5">
        {round.combos.map((rc, i) => (
          <div key={rc.id} className="mb-3 last:mb-0">
            <span className="mr-3 text-sm font-bold text-[#E8C860]">{i + 1}.</span>
            <span className="text-base text-zinc-100">{rc.combo?.text ?? 'Unknown combo'}</span>
          </div>
        ))}
      </div>

      {/* Timer / Start */}
      {phase === 'ready' ? (
        <div className="mt-8 flex flex-col items-center">
          <p className="mb-2 text-5xl font-bold tabular-nums text-zinc-100">
            {formatTime(round.durationSec)}
          </p>
          <p className="mb-6 text-sm text-zinc-500">Round duration</p>
          <button
            onClick={handleStartRound}
            className="min-h-[48px] rounded-xl bg-[#E8C860] px-8 py-3 text-base font-bold text-zinc-950 active:bg-[#C8A030]"
          >
            Start Round
          </button>
        </div>
      ) : (
        <div>
          <RoundTimer
            secondsRemaining={roundTimer.secondsRemaining}
            isOvertime={roundTimer.isOvertime}
            onTimerEnd={handleRoundEnd}
          />
          <div className="mt-6 flex justify-center">
            <button
              onClick={handleRoundEnd}
              className="min-h-[44px] rounded-lg bg-zinc-800 px-6 py-2 text-sm font-medium text-zinc-400 active:bg-zinc-700"
            >
              End Round Early
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
