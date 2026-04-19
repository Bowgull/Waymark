import { useEffect } from 'react'

import { RingTimer } from '@/components/RingTimer'
import { Button } from '@/components/ui/button'
import { ForgeIcon } from '@/components/icons/SessionIcons'
import { heavyHaptic } from '@/lib/haptics'
import {
  soundRoundStart,
  soundRoundEnd,
  soundFinishWarning,
  soundRestWarning,
} from '@/lib/sounds'
import { activateSessionAudio, deactivateSessionAudio } from '@/lib/sessionAudio'
import {
  scheduleRoundActiveCues,
  cancelRoundActiveCues,
  scheduleRestCues,
  cancelRestCues,
} from '@/lib/notifications'

import { SessionShell } from './SessionShell'
import {
  resolveBagWorkMoment,
  type BagWorkIntent,
} from './bagWorkMicrocopy'
import { useRestTimer } from './useRestTimer'
import { useSessionLiveActivity, type LiveActivityConfig } from './useSessionLiveActivity'

interface ComboData {
  id: string
  orderIndex: number
  combo: {
    id: string
    text: string
    tier: string
    level: string
    masteryScore?: number
    isFavourite?: number
    techniques?: string
    formTips?: string
  } | null
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
const ROUND_INTENTS: { label: BagWorkIntent; hint: string }[] = [
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
  onExit?: () => void
}

export function BagWorkRoundView({
  round,
  totalRounds,
  phase,
  onPhaseChange,
  onNextRound,
  onComplete,
  onExit,
}: BagWorkRoundViewProps) {
  const roundTimer = useRestTimer()
  const restTimer = useRestTimer()

  const isLastRound = round.roundNumber >= totalRounds

  // Activate the native AVAudioSession so in-session cues duck Spotify / other
  // apps' audio. Deactivates with .notifyOthersOnDeactivation on unmount so the
  // music returns to full volume immediately when the user leaves the view.
  useEffect(() => {
    void activateSessionAudio()
    return () => { void deactivateSessionAudio() }
  }, [])

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

  // Live Activity: drive the lock-screen timer + Dynamic Island.
  const firstComboName = round.combos[0]?.combo?.text ?? undefined
  const activityConfig: LiveActivityConfig | null =
    phase === 'fighting' && roundTimer.isRunning
      ? {
          sessionType: 'bag_work',
          sessionLabel: 'Bag Work',
          state: {
            phase: 'active',
            label: `Round ${round.roundNumber} of ${totalRounds}`,
            detail: firstComboName,
            startedAt: roundTimer.startedAtMs,
            endsAt: roundTimer.endsAtMs,
            isPaused: roundTimer.isPaused,
            pausedRemaining: roundTimer.isPaused
              ? roundTimer.secondsRemaining
              : undefined,
          },
        }
      : phase === 'rest' && restTimer.isRunning
        ? {
            sessionType: 'bag_work',
            sessionLabel: 'Bag Work',
            state: {
              phase: 'rest',
              label: 'Rest',
              detail: `Next: Round ${round.roundNumber + 1}`,
              startedAt: restTimer.startedAtMs,
              endsAt: restTimer.endsAtMs,
              isPaused: restTimer.isPaused,
              pausedRemaining: restTimer.isPaused
                ? restTimer.secondsRemaining
                : undefined,
            },
          }
        : null

  function pauseRound() {
    cancelRoundActiveCues()
    roundTimer.pause()
  }
  function resumeRound(newEndsAtMs?: number) {
    roundTimer.resume(newEndsAtMs)
    const remaining = newEndsAtMs
      ? Math.max(0, Math.round((newEndsAtMs - Date.now()) / 1000))
      : roundTimer.secondsRemaining
    if (remaining > 0) scheduleRoundActiveCues(remaining)
  }
  function pauseRest() {
    cancelRestCues()
    restTimer.pause()
  }
  function resumeRest(newEndsAtMs?: number) {
    restTimer.resume(newEndsAtMs)
    const remaining = newEndsAtMs
      ? Math.max(0, Math.round((newEndsAtMs - Date.now()) / 1000))
      : restTimer.secondsRemaining
    if (remaining > 0) scheduleRestCues(remaining)
  }

  useSessionLiveActivity(activityConfig, {
    onPause: () => {
      if (phase === 'fighting') pauseRound()
      else if (phase === 'rest') pauseRest()
    },
    onResume: (newEndsAtMs) => {
      if (phase === 'fighting') resumeRound(newEndsAtMs)
      else if (phase === 'rest') resumeRest(newEndsAtMs)
    },
  })

  // Determine tier of combos + intent labels for this round
  const roundTier = round.combos[0]?.combo?.tier
  const coachRationale = (round.coachRationale ?? '').trim()
  const roundTypeLabel = round.roundType ? ROUND_TYPE_LABELS[round.roundType] ?? null : null
  const positionalIntent = ROUND_INTENTS[round.roundNumber - 1] ?? null

  // Shell counter + progress
  const counter = phase === 'rest'
    ? 'Rest'
    : `Round ${round.roundNumber} of ${totalRounds}`
  const progress = {
    completed: round.roundNumber - 1,
    active: round.roundNumber - 1,
    total: totalRounds,
  }

  // Moment line (Flavor C)
  const moment = resolveBagWorkMoment({
    phase:
      phase === 'rest'
        ? 'rest'
        : phase === 'fighting'
          ? 'fighting'
          : 'ready',
    intent: positionalIntent?.label,
    roundType: round.roundType ?? null,
    isLastRound,
    secondsRemaining:
      phase === 'fighting'
        ? roundTimer.secondsRemaining
        : phase === 'rest'
          ? restTimer.secondsRemaining
          : undefined,
  })

  // Footer action per phase
  const footer =
    phase === 'ready' ? (
      <Button
        onClick={handleStartRound}
        size="lg"
        className="w-full"
        style={{ backgroundColor: '#E8C860', color: '#020A08' }}
      >
        Start Round
      </Button>
    ) : phase === 'fighting' ? (
      <Button onClick={handleRoundEnd} variant="secondary" size="lg" className="w-full">
        End Round Early
      </Button>
    ) : (
      <Button
        onClick={handleRestDone}
        size="lg"
        className="w-full"
        style={{ backgroundColor: '#E8C860', color: '#020A08' }}
      >
        Next Round
      </Button>
    )

  // ─── Body ────────────────────────────────────────────────────

  const body =
    phase === 'rest' ? (
      <div className="mx-auto flex max-w-md flex-col items-center pt-6 animate-fade-in">
        <p className="font-cinzel text-[11px] uppercase tracking-[0.28em] text-gold/50">
          Between Rounds
        </p>
        <h2 className="mt-1 text-display-lg text-foreground">Recover</h2>
        <div className="mt-8 rounded-2xl border border-gold/15 bg-deep-forest/60 p-5 shadow-[inset_0_1px_0_rgba(232,200,96,0.06)]">
          <RingTimer
            totalSeconds={round.restSec}
            secondsRemaining={restTimer.secondsRemaining}
            isOvertime={restTimer.isOvertime}
            label={restTimer.isOvertime ? 'Over' : 'Rest'}
            accentColor="#E8C860"
            isPaused={restTimer.isPaused}
            onTogglePause={() => (restTimer.isPaused ? resumeRest() : pauseRest())}
          />
        </div>
      </div>
    ) : (
      <div className="mx-auto max-w-md animate-fade-in">
        {(roundTypeLabel || roundTier) && (
          <p className="font-cinzel text-xs uppercase tracking-[0.22em] text-gold/60">
            {roundTypeLabel ?? TIER_LABELS[roundTier ?? ''] ?? roundTier}
          </p>
        )}
        {coachRationale ? (
          <p className="mt-1 text-[12px] italic text-muted-foreground/75">
            {coachRationale}
          </p>
        ) : positionalIntent ? (
          <p className="mt-1 text-[12px] text-muted-foreground/60">
            {positionalIntent.label}. {positionalIntent.hint}.
          </p>
        ) : null}

        {/* Combo card */}
        <div className="mt-4 rounded border border-gold/15 bg-gradient-to-b from-[#1A1A10]/60 to-[#12170E]/40 p-5 shadow-[0_0_12px_rgba(0,0,0,0.3)]">
          {round.combos.map((rc, i) => {
            const mastery = rc.combo?.masteryScore ?? 0
            const isFav = rc.combo?.isFavourite === 1
            const dots = Math.min(Math.floor(mastery / 3), 5)
            const techniques = rc.combo?.techniques?.split(',').filter(Boolean) ?? []

            return (
              <div key={rc.id} className="mb-3 last:mb-0 flex items-start gap-2">
                <span className="shrink-0 text-sm font-bold text-gold">{i + 1}.</span>
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

        {/* Timer card */}
        <div className="mt-8 flex justify-center">
          <div className="rounded-2xl border border-gold/15 bg-deep-forest/60 p-5 shadow-[inset_0_1px_0_rgba(232,200,96,0.06)]">
            <RingTimer
              totalSeconds={round.durationSec}
              secondsRemaining={phase === 'fighting' ? roundTimer.secondsRemaining : round.durationSec}
              isOvertime={phase === 'fighting' ? roundTimer.isOvertime : false}
              label={
                phase === 'fighting'
                  ? roundTimer.secondsRemaining <= 10
                    ? 'Finish'
                    : 'Fight'
                  : 'Round'
              }
              accentColor={
                phase === 'fighting' && roundTimer.secondsRemaining <= 10
                  ? '#C45A3C'
                  : '#E8C860'
              }
              isPaused={phase === 'fighting' && roundTimer.isPaused}
              onTogglePause={
                phase === 'fighting'
                  ? () => (roundTimer.isPaused ? resumeRound() : pauseRound())
                  : undefined
              }
            />
          </div>
        </div>
      </div>
    )

  return (
    <SessionShell
      sessionType="bag_work"
      counter={counter}
      progress={progress}
      moment={moment}
      onExit={onExit}
      footer={footer}
    >
      {body}
    </SessionShell>
  )
}
