import { useCallback, useEffect, useRef, useState } from 'react'

import { RingTimer } from '@/components/RingTimer'
import { Button } from '@/components/ui/button'
import {
  scheduleRoundCuesUntil,
  scheduleRestCuesUntil,
  cancelRoundActiveCues,
  cancelRestCues,
} from '@/lib/notifications'
import { soundRoundEnd, soundRoundStart } from '@/lib/sounds'
import { SKIP_ROPE_REST_SEC, isStaleCue, type EngineState } from '@/lib/sessionResume'
import { useWakeLock } from '@/lib/wakeLock'

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

const SKIP_REST_SEC = SKIP_ROPE_REST_SEC

type RoundsState = Extract<EngineState, { kind: 'rounds' }>

interface SkipRopeViewProps {
  skipSession: SkipSession
  onComplete: () => void
  onExit?: () => void
  /** Saved state (session resume), already brought up to now. */
  resume?: RoundsState | null
  /** Called on every change so the session can be resumed exactly here. */
  onPersist?: (state: RoundsState) => void
}

export function SkipRopeView({ skipSession, onComplete, onExit, resume, onPersist }: SkipRopeViewProps) {
  // Round is 1-based here; the saved state is 0-based like bag work.
  const [currentRound, setCurrentRound] = useState(() => (resume ? resume.round + 1 : 1))
  const [skipPhase, setSkipPhase] = useState<SkipPhase>(() =>
    resume ? (resume.sub === 'fighting' ? 'skipping' : resume.sub) : 'ready',
  )
  const roundTimer = useRestTimer()
  const restTimer = useRestTimer()

  const totalRounds = skipSession.roundCount
  const isLastRound = currentRound >= totalRounds
  const accent = '#1E8A68'

  // Resume: put the saved timer back and re-sync cues to its real end.
  const restoredRef = useRef(false)
  const restoreRound = roundTimer.restore
  const restoreRest = restTimer.restore
  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    if (!resume?.timer) return
    const t = resume.timer
    if (resume.sub === 'fighting') {
      restoreRound(t)
      if (t.state === 'running') void scheduleRoundCuesUntil(t.endsAtMs, resume.round + 1 >= totalRounds ? null : SKIP_REST_SEC)
    } else if (resume.sub === 'rest') {
      restoreRest(t)
      if (t.state === 'running') void scheduleRestCuesUntil(t.endsAtMs)
    }
  }, [resume, restoreRest, restoreRound, totalRounds])

  const roundSnapshot = roundTimer.snapshot
  const restSnapshot = restTimer.snapshot
  useEffect(() => {
    onPersist?.({
      kind: 'rounds',
      round: currentRound - 1,
      sub: skipPhase === 'skipping' ? 'fighting' : skipPhase,
      timer: skipPhase === 'skipping' ? roundSnapshot() : skipPhase === 'rest' ? restSnapshot() : null,
    })
  }, [onPersist, currentRound, skipPhase, roundSnapshot, restSnapshot, roundTimer.isRunning, roundTimer.isPaused, roundTimer.endsAtMs, restTimer.isRunning, restTimer.isPaused, restTimer.endsAtMs])

  useWakeLock(
    (skipPhase === 'skipping' && roundTimer.isRunning && !roundTimer.isPaused) ||
    (skipPhase === 'rest' && restTimer.isRunning && !restTimer.isPaused),
  )

  function startRound() {
    soundRoundStart()
    roundTimer.start(skipSession.roundDurSec)
    void scheduleRoundCuesUntil(Date.now() + skipSession.roundDurSec * 1000, isLastRound ? null : SKIP_REST_SEC)
    setSkipPhase('skipping')
  }

  const endRound = useCallback((natural = false) => {
    const endedAt = natural && roundTimer.endsAtMs > 0 ? roundTimer.endsAtMs : Date.now()
    if (natural && !isStaleCue(endedAt, Date.now())) soundRoundEnd()
    roundTimer.stop()
    void cancelRoundActiveCues()
    if (isLastRound) {
      void cancelRestCues()
      onComplete()
    } else {
      restTimer.startFrom(endedAt, SKIP_REST_SEC)
      if (!natural) void scheduleRestCuesUntil(endedAt + SKIP_REST_SEC * 1000)
      setSkipPhase('rest')
    }
  }, [isLastRound, onComplete, restTimer, roundTimer])

  const nextRound = useCallback((natural = false) => {
    if (natural && !isStaleCue(restTimer.endsAtMs, Date.now())) soundRoundStart()
    restTimer.stop()
    void cancelRestCues()
    setCurrentRound(r => r + 1)
    setSkipPhase('ready')
  }, [restTimer])

  // Time ran out (also after a lock: <= 0 catches a jump past zero).
  useEffect(() => {
    if (!(skipPhase === 'skipping' && roundTimer.isRunning && !roundTimer.isPaused && roundTimer.secondsRemaining <= 0)) return
    const t = setTimeout(() => endRound(true), 0)
    return () => clearTimeout(t)
  }, [endRound, roundTimer.isPaused, roundTimer.isRunning, roundTimer.secondsRemaining, skipPhase])

  // Rest runs into overtime ("Over") until Next Round is tapped, as before.

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

  function pauseRound(pausedRemainingMs?: number) {
    void cancelRoundActiveCues()
    void cancelRestCues()
    roundTimer.pause(pausedRemainingMs)
  }
  function resumeRound(newEndsAtMs?: number) {
    const endsAt = roundTimer.resume(newEndsAtMs)
    if (endsAt > Date.now()) void scheduleRoundCuesUntil(endsAt, isLastRound ? null : SKIP_REST_SEC)
  }
  function pauseRest(pausedRemainingMs?: number) {
    void cancelRestCues()
    restTimer.pause(pausedRemainingMs)
  }
  function resumeRest(newEndsAtMs?: number) {
    const endsAt = restTimer.resume(newEndsAtMs)
    if (endsAt > Date.now()) void scheduleRestCuesUntil(endsAt)
  }

  function restartCurrentPhase() {
    if (skipPhase === 'skipping') {
      roundTimer.start(skipSession.roundDurSec)
      void scheduleRoundCuesUntil(Date.now() + skipSession.roundDurSec * 1000, isLastRound ? null : SKIP_REST_SEC)
    } else if (skipPhase === 'rest') {
      restTimer.start(SKIP_REST_SEC)
      void scheduleRestCuesUntil(Date.now() + SKIP_REST_SEC * 1000)
    }
  }

  useSessionLiveActivity(skipActivityConfig, {
    onPause: (pausedRemainingMs) => {
      if (skipPhase === 'skipping') pauseRound(pausedRemainingMs)
      else if (skipPhase === 'rest') pauseRest(pausedRemainingMs)
    },
    onResume: (newEndsAtMs) => {
      if (skipPhase === 'skipping') resumeRound(newEndsAtMs)
      else if (skipPhase === 'rest') resumeRest(newEndsAtMs)
    },
    onRestart: restartCurrentPhase,
    onEnd: () => {
      // Lock-screen End leaves the session (still in progress, resumable).
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
      <Button onClick={() => endRound()} variant="secondary" size="lg" className="w-full">
        End Round Early
      </Button>
    ) : (
      <Button
        onClick={() => nextRound()}
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
            totalSeconds={SKIP_REST_SEC}
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
