import { useEffect } from 'react'

import { RingTimer } from '@/components/RingTimer'
import { Button } from '@/components/ui/button'
import { heavyHaptic } from '@/lib/haptics'

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
    heavyHaptic()
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

  useEffect(() => {
    if (phase === 'fighting' && roundTimer.secondsRemaining === 0 && !roundTimer.isOvertime && roundTimer.isRunning) {
      handleRoundEnd()
    }
  }, [roundTimer.secondsRemaining, roundTimer.isOvertime, roundTimer.isRunning, phase])

  if (phase === 'rest') {
    return (
      <div className="animate-fade-in">
        <p className="text-label text-center text-muted-foreground">
          Round {round.roundNumber} of {totalRounds} — Rest
        </p>
        <RestTimer
          totalSeconds={round.restSec}
          secondsRemaining={restTimer.secondsRemaining}
          isOvertime={restTimer.isOvertime}
          onNext={handleRestDone}
          accentColor="#E8C860"
        />
      </div>
    )
  }

  return (
    <div className="animate-fade-in">
      <p className="text-label mb-1 text-muted-foreground">
        Round {round.roundNumber} of {totalRounds}
      </p>

      {/* Combo card */}
      <div className="mt-4 border border-border border-l-4 border-l-gold bg-deep-forest p-5">
        {round.combos.map((rc, i) => (
          <div key={rc.id} className="mb-3 last:mb-0">
            <span className="mr-3 text-sm font-bold text-gold">{i + 1}.</span>
            <span className="text-base text-foreground">{rc.combo?.text ?? 'Unknown combo'}</span>
          </div>
        ))}
      </div>

      {phase === 'ready' ? (
        <div className="mt-8 flex flex-col items-center">
          <RingTimer
            totalSeconds={round.durationSec}
            secondsRemaining={round.durationSec}
            label="Round"
            accentColor="#E8C860"
          />
          <Button onClick={handleStartRound} size="lg" className="mt-6">
            Start Round
          </Button>
        </div>
      ) : (
        <div className="mt-6 flex flex-col items-center">
          <RingTimer
            totalSeconds={round.durationSec}
            secondsRemaining={roundTimer.secondsRemaining}
            isOvertime={roundTimer.isOvertime}
            label={roundTimer.secondsRemaining <= 10 ? 'Finish' : 'Fight'}
            accentColor={roundTimer.secondsRemaining <= 10 ? '#C45A3C' : '#E8C860'}
          />
          <Button
            onClick={handleRoundEnd}
            variant="secondary"
            className="mt-6"
          >
            End Round Early
          </Button>
        </div>
      )}
    </div>
  )
}
