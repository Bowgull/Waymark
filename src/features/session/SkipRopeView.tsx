import { useState } from 'react'

import { RingTimer } from '@/components/RingTimer'
import { Button } from '@/components/ui/button'
import {
  scheduleRoundActiveCues,
  cancelRoundActiveCues,
  scheduleRestCues,
  cancelRestCues,
} from '@/lib/notifications'

import { SessionShell } from './SessionShell'
import { resolveSkipRopeMoment } from './skipRopeMicrocopy'
import { useRestTimer } from './useRestTimer'
import { useSessionLiveActivity, type LiveActivityConfig } from './useSessionLiveActivity'

interface SkipSession {
  id: string
  roundCount: number
  roundDurSec: number
}

type SkipPhase = 'ready' | 'skipping' | 'rest'

interface SkipRopeViewProps {
  skipSession: SkipSession
  onComplete: () => void
  onExit?: () => void
}

export function SkipRopeView({ skipSession, onComplete, onExit }: SkipRopeViewProps) {
  const [currentRound, setCurrentRound] = useState(1)
  const [skipPhase, setSkipPhase] = useState<SkipPhase>('ready')
  const roundTimer = useRestTimer()
  const restTimer = useRestTimer()

  const totalRounds = skipSession.roundCount
  const isLastRound = currentRound >= totalRounds
  const accent = '#1E8A68'

  function startRound() {
    roundTimer.start(skipSession.roundDurSec)
    scheduleRoundActiveCues(skipSession.roundDurSec)
    setSkipPhase('skipping')
  }

  function endRound() {
    roundTimer.stop()
    cancelRoundActiveCues()
    if (isLastRound) {
      onComplete()
    } else {
      restTimer.start(60)
      scheduleRestCues(60)
      setSkipPhase('rest')
    }
  }

  function nextRound() {
    restTimer.stop()
    cancelRestCues()
    setCurrentRound(currentRound + 1)
    setSkipPhase('ready')
  }

  if (skipPhase === 'skipping' && roundTimer.secondsRemaining <= 0 && roundTimer.isRunning) {
    endRound()
  }

  // Live Activity for skip rope timer.
  const skipActivityConfig: LiveActivityConfig | null =
    skipPhase === 'skipping' && roundTimer.isRunning
      ? {
          sessionType: 'skip_rope',
          sessionLabel: 'Skip Rope',
          state: {
            phase: 'active',
            label: `Round ${currentRound} of ${totalRounds}`,
            startedAt: roundTimer.startedAtMs,
            endsAt: roundTimer.endsAtMs,
            isPaused: roundTimer.isPaused,
            pausedRemaining: roundTimer.isPaused
              ? roundTimer.secondsRemaining
              : undefined,
          },
        }
      : skipPhase === 'rest' && restTimer.isRunning
        ? {
            sessionType: 'skip_rope',
            sessionLabel: 'Skip Rope',
            state: {
              phase: 'rest',
              label: 'Rest',
              detail: `Next: Round ${currentRound + 1}`,
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

  function restartCurrentPhase() {
    if (skipPhase === 'skipping') {
      cancelRoundActiveCues()
      roundTimer.start(skipSession.roundDurSec)
      scheduleRoundActiveCues(skipSession.roundDurSec)
    } else if (skipPhase === 'rest') {
      cancelRestCues()
      restTimer.start(60)
      scheduleRestCues(60)
    }
  }

  useSessionLiveActivity(skipActivityConfig, {
    onPause: () => {
      if (skipPhase === 'skipping') pauseRound()
      else if (skipPhase === 'rest') pauseRest()
    },
    onResume: (newEndsAtMs) => {
      if (skipPhase === 'skipping') resumeRound(newEndsAtMs)
      else if (skipPhase === 'rest') resumeRest(newEndsAtMs)
    },
    onRestart: restartCurrentPhase,
    onEnd: () => {
      cancelRoundActiveCues()
      cancelRestCues()
      roundTimer.stop()
      restTimer.stop()
      onExit?.()
    },
    // "Next →" from the lock screen: skipping → end round early, rest →
    // start next round.
    onAdvance: () => {
      if (skipPhase === 'skipping') endRound()
      else if (skipPhase === 'rest') nextRound()
    },
  })

  const moment = resolveSkipRopeMoment({
    phase:
      skipPhase === 'rest'
        ? 'rest'
        : skipPhase === 'skipping'
          ? 'skipping'
          : 'ready',
    isLastRound,
    secondsRemaining:
      skipPhase === 'skipping'
        ? roundTimer.secondsRemaining
        : skipPhase === 'rest'
          ? restTimer.secondsRemaining
          : undefined,
  })

  const counter =
    skipPhase === 'rest'
      ? 'Rest'
      : `Round ${currentRound} of ${totalRounds}`

  const progress = {
    completed: currentRound - 1,
    active: currentRound - 1,
    total: totalRounds,
  }

  const footer =
    skipPhase === 'ready' ? (
      <Button
        onClick={startRound}
        size="lg"
        className="w-full"
        style={{ backgroundColor: accent, color: '#020A08' }}
      >
        Start Round
      </Button>
    ) : skipPhase === 'skipping' ? (
      <Button onClick={endRound} variant="secondary" size="lg" className="w-full">
        End Round Early
      </Button>
    ) : (
      <Button
        onClick={nextRound}
        size="lg"
        className="w-full"
        style={{ backgroundColor: accent, color: '#020A08' }}
      >
        Next Round
      </Button>
    )

  const body =
    skipPhase === 'rest' ? (
      <div className="mx-auto flex max-w-md flex-col items-center pt-6 animate-fade-in">
        <p className="font-cinzel text-[11px] uppercase tracking-[0.28em] text-gold/50">
          Between Rounds
        </p>
        <h2 className="mt-1 text-display-lg text-foreground">Recover</h2>
        <div className="mt-8 rounded-2xl border border-gold/15 bg-deep-forest/60 p-5 shadow-[inset_0_1px_0_rgba(232,200,96,0.06)]">
          <RingTimer
            totalSeconds={60}
            secondsRemaining={restTimer.secondsRemaining}
            isOvertime={restTimer.isOvertime}
            label={restTimer.isOvertime ? 'Over' : 'Rest'}
            accentColor={accent}
            isPaused={restTimer.isPaused}
            onTogglePause={() => (restTimer.isPaused ? resumeRest() : pauseRest())}
          />
        </div>
      </div>
    ) : (
      <div className="mx-auto max-w-md animate-fade-in">
        <h2 className="text-display-lg leading-[1.1] text-foreground">Skip Rope</h2>
        <p className="mt-3 text-sm leading-relaxed text-foreground/85">
          Steady rhythm. Stay light on the balls of your feet. Relax your shoulders.
        </p>

        <div className="mt-8 flex justify-center">
          <div className="rounded-2xl border border-gold/15 bg-deep-forest/60 p-5 shadow-[inset_0_1px_0_rgba(232,200,96,0.06)]">
            <RingTimer
              totalSeconds={skipSession.roundDurSec}
              secondsRemaining={
                skipPhase === 'skipping'
                  ? roundTimer.secondsRemaining
                  : skipSession.roundDurSec
              }
              isOvertime={skipPhase === 'skipping' ? roundTimer.isOvertime : false}
              label={
                skipPhase === 'skipping'
                  ? roundTimer.secondsRemaining <= 10
                    ? 'Finish'
                    : 'Skip'
                  : 'Round'
              }
              accentColor={
                skipPhase === 'skipping' && roundTimer.secondsRemaining <= 10
                  ? '#C45A3C'
                  : accent
              }
              isPaused={skipPhase === 'skipping' && roundTimer.isPaused}
              onTogglePause={
                skipPhase === 'skipping'
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
      sessionType="skip_rope"
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
