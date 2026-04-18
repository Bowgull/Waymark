import { useEffect } from 'react'

import { RingTimer } from '@/components/RingTimer'
import { Button } from '@/components/ui/button'
import { ForgeIcon } from '@/components/icons/SessionIcons'
import { heavyHaptic } from '@/lib/haptics'
import { soundRoundStart, soundRoundEnd, soundFinishWarning, soundRestWarning } from '@/lib/sounds'
import {
  scheduleRoundActiveCues,
  cancelRoundActiveCues,
  scheduleRestCues,
  cancelRestCues,
} from '@/lib/notifications'

import { RestTimer } from './RestTimer'
import { useRestTimer } from './useRestTimer'

interface ComboData {
  id: string
  orderIndex: number
  combo: { id: string; text: string; tier: string; level: string; masteryScore?: number; isFavourite?: number; techniques?: string; formTips?: string } | null
}

const TIER_LABELS: Record<string, string> = {
  foundation: 'Fundamentals',
  weapons: 'Weapons',
  flow: 'Flow',
  deception: 'Deception',
  mastery: 'Mastery',
}

// Intensity-progression model: each round has a coaching intent.
// Technical → Rhythm → Volume × 2 → Pressure → Power
const ROUND_INTENTS = [
  { label: 'Technical', hint: 'Sharp mechanics, controlled pace' },
  { label: 'Rhythm', hint: 'Find your flow' },
  { label: 'Volume', hint: 'Push the output' },
  { label: 'Volume', hint: 'Stay consistent' },
  { label: 'Pressure', hint: 'Controlled aggression' },
  { label: 'Power', hint: 'Max output' },
]

interface RoundData {
  id: string
  roundNumber: number
  durationSec: number
  restSec: number
  roundType?: string | null
  coachRationale?: string | null
  combos: ComboData[]
}

const ROUND_TYPE_LABELS: Record<string, string> = {
  warmup: 'Warmup',
  technical_flow: 'Technical',
  drill_isolation: 'Drill',
  combo_practice: 'Combos',
  power: 'Power',
  conditioning: 'Conditioning',
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
    soundRoundStart()
    roundTimer.start(round.durationSec)
    scheduleRoundActiveCues(round.durationSec)
    onPhaseChange('fighting')
  }

  function handleRoundEnd() {
    soundRoundEnd()
    roundTimer.stop()
    cancelRoundActiveCues()
    if (isLastRound) {
      onComplete()
    } else {
      restTimer.start(round.restSec)
      scheduleRestCues(round.restSec)
      onPhaseChange('rest')
    }
  }

  function handleRestDone() {
    restTimer.stop()
    cancelRestCues()
    onNextRound()
  }

  useEffect(() => {
    // Use <= 0 so a locked-screen jump past zero still fires
    if (phase === 'fighting' && roundTimer.secondsRemaining <= 0 && roundTimer.isRunning) {
      handleRoundEnd()
    }
  }, [roundTimer.secondsRemaining, roundTimer.isRunning, phase])

  // Last 10 seconds of round — finish warning (screen on only; notification handles locked)
  useEffect(() => {
    if (phase === 'fighting' && roundTimer.secondsRemaining === 10) {
      soundFinishWarning()
    }
  }, [roundTimer.secondsRemaining, phase])

  // Auto-advance rest timer
  useEffect(() => {
    if (phase === 'rest' && restTimer.secondsRemaining <= 0 && restTimer.isRunning) {
      handleRestDone()
    }
  }, [restTimer.secondsRemaining, restTimer.isRunning, phase])

  // 10 seconds left in rest — heads up (screen on only; notification handles locked)
  useEffect(() => {
    if (phase === 'rest' && restTimer.secondsRemaining === 10) {
      soundRestWarning()
    }
  }, [restTimer.secondsRemaining, phase])

  // Determine tier of combos in this round
  const roundTier = round.combos[0]?.combo?.tier
  const coachRationale = (round.coachRationale ?? '').trim()
  const roundTypeLabel = round.roundType ? ROUND_TYPE_LABELS[round.roundType] ?? null : null
  const positionalIntent = ROUND_INTENTS[round.roundNumber - 1] ?? null

  if (phase === 'rest') {
    return (
      <div className="animate-fade-in">
        <p className="text-label text-center text-muted-foreground">
          Round {round.roundNumber} of {totalRounds} · Rest
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
      {(roundTypeLabel || roundTier) && (
        <p className="text-xs font-cinzel tracking-wider text-gold/50">
          {roundTypeLabel ?? TIER_LABELS[roundTier ?? ''] ?? roundTier}
        </p>
      )}
      {coachRationale ? (
        <p className="text-[11px] text-muted-foreground/70 mt-0.5 italic">
          {coachRationale}
        </p>
      ) : positionalIntent ? (
        <p className="text-[11px] text-muted-foreground/50 mt-0.5">
          {positionalIntent.label}. {positionalIntent.hint}
        </p>
      ) : null}

      {/* Combo card — Option 3: Parchment/worn page */}
      <div className="mt-4 rounded border border-gold/15 bg-gradient-to-b from-[#1A1A10]/60 to-[#12170E]/40 p-5 shadow-[0_0_12px_rgba(0,0,0,0.3)]">
        {round.combos.map((rc, i) => {
          const mastery = rc.combo?.masteryScore ?? 0
          const isFav = rc.combo?.isFavourite === 1
          const dots = Math.min(Math.floor(mastery / 3), 5)

          const techniques = rc.combo?.techniques?.split(',').filter(Boolean) ?? []

          return (
            <div key={rc.id} className="mb-3 last:mb-0 flex items-start gap-2">
              <span className="text-sm font-bold text-gold shrink-0">{i + 1}.</span>
              <div className="flex-1">
                <span className="text-base text-foreground">
                  {rc.combo?.text ?? 'Unknown combo'}
                  {(isFav || mastery >= 9) && (
                    <span className="ml-1.5 inline-flex text-gold">
                      <ForgeIcon size={12} mastered={mastery >= 9} />
                    </span>
                  )}
                </span>
                {techniques.length > 0 && (
                  <p className="mt-0.5 text-[13px] italic text-muted-foreground">
                    {techniques.join(' \u00b7 ')}
                  </p>
                )}
                {rc.combo?.formTips && (
                  <p className="mt-1.5 font-cinzel text-xs leading-snug text-teal/80">
                    {rc.combo.formTips}
                  </p>
                )}
                {mastery > 0 && (
                  <div className="mt-1 flex gap-1">
                    {Array.from({ length: 5 }, (_, di) => (
                      <span
                        key={di}
                        className={`h-1.5 w-1.5 rounded-full ${di < dots ? 'bg-gold' : 'bg-border'}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
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
