import { useState } from 'react'

import { RingTimer } from '@/components/RingTimer'
import { Button } from '@/components/ui/button'

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

  if (skipPhase === 'skipping' && roundTimer.secondsRemaining <= 0 && roundTimer.isRunning) {
    endRound()
  }

  if (skipPhase === 'rest') {
    return (
      <div className="animate-fade-in">
        <p className="text-label text-center text-muted-foreground">
          Round {currentRound} of {totalRounds} · Rest
        </p>
        <RestTimer
          totalSeconds={60}
          secondsRemaining={restTimer.secondsRemaining}
          isOvertime={restTimer.isOvertime}
          onNext={nextRound}
          accentColor="#1E8A68"
        />
      </div>
    )
  }

  return (
    <div className="animate-fade-in">
      <p className="text-label mb-1 text-muted-foreground">
        Round {currentRound} of {totalRounds}
      </p>
      <h2 className="text-display-lg text-foreground">Skip Rope</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Steady rhythm. Stay light on the balls of your feet. Relax your shoulders.
      </p>

      {skipPhase === 'ready' ? (
        <div className="mt-8 flex flex-col items-center">
          <RingTimer
            totalSeconds={skipSession.roundDurSec}
            secondsRemaining={skipSession.roundDurSec}
            label="Round"
            accentColor="#1E8A68"
          />
          <Button onClick={startRound} size="lg" className="mt-6" style={{ backgroundColor: '#1E8A68' }}>
            Start Round
          </Button>
        </div>
      ) : (
        <div className="mt-6 flex flex-col items-center">
          <RingTimer
            totalSeconds={skipSession.roundDurSec}
            secondsRemaining={roundTimer.secondsRemaining}
            isOvertime={roundTimer.isOvertime}
            label={roundTimer.secondsRemaining <= 10 ? 'Finish' : 'Skip'}
            accentColor={roundTimer.secondsRemaining <= 10 ? '#C45A3C' : '#1E8A68'}
          />
          <Button onClick={endRound} variant="secondary" className="mt-6">
            End Round Early
          </Button>
        </div>
      )}
    </div>
  )
}
