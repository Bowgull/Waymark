import { useCallback, useEffect, useRef, useState } from 'react'

import { CountRow, GrassZone, HeroClock, NextLine, PhaseWord, SessionFrame, shortTime, TimerColumn, type TimerTrack } from '@/components/timers'
import {
  scheduleRoundCuesUntil,
  scheduleRestCuesUntil,
  cancelRoundActiveCues,
  cancelRestCues,
} from '@/lib/notifications'
import { soundRoundEnd, soundRoundStart } from '@/lib/sounds'
import { SKIP_ROPE_REST_SEC, isStaleCue, type EngineState } from '@/lib/sessionResume'
import { roundsBack, type RoundSpot } from '@/lib/timers/bagRound'
import { freshSnap } from '@/lib/timers/swipeBack'
import { backStep, heatFor, workLabel } from '@/lib/timers/timerLook'
import { useWakeLock } from '@/lib/wakeLock'

import { useRestTimer } from './useRestTimer'
import { ropeGlow } from '@/lib/lockGlow'
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
  /** A round ended: its index (0-based) and the seconds actually skipped (the done summary's per-round lines). */
  onRoundDone?: (roundIndex: number, actualSec: number) => void
}

export function SkipRopeView({ skipSession, onComplete, onExit, resume, onPersist, onRoundDone }: SkipRopeViewProps) {
  // Round is 1-based here; the saved state is 0-based like bag work.
  const [currentRound, setCurrentRound] = useState(() => (resume ? resume.round + 1 : 1))
  const [skipPhase, setSkipPhase] = useState<SkipPhase>(() =>
    resume ? (resume.sub === 'fighting' ? 'skipping' : resume.sub) : 'ready',
  )
  const roundTimer = useRestTimer()
  const restTimer = useRestTimer()

  const totalRounds = skipSession.roundCount
  const isLastRound = currentRound >= totalRounds

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
    const dur = skipSession.roundDurSec
    onRoundDone?.(currentRound - 1, natural ? dur : Math.max(0, Math.min(dur, dur - Math.max(0, roundTimer.secondsRemaining))))
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
  }, [currentRound, isLastRound, onComplete, onRoundDone, restTimer, roundTimer, skipSession.roundDurSec])

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
            stepIndex: currentRound,
            stepTotal: totalRounds,
            ...ropeGlow(currentRound, false),
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
              stepIndex: currentRound,
              stepTotal: totalRounds,
              ...ropeGlow(currentRound, true),
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


  // ─── The screen (page 19's timer: the same grass, flaps and heat as a round) ───

  const skipping = skipPhase === 'skipping'
  const resting = skipPhase === 'rest'
  const shownSec = skipping ? Math.max(0, roundTimer.secondsRemaining) : resting ? Math.max(0, restTimer.secondsRemaining) : skipSession.roundDurSec
  const heat = skipping ? heatFor(shownSec) : null
  const label = resting ? (restTimer.isOvertime ? 'OVER' : 'REST') : skipping ? workLabel('SKIP', shownSec) : 'READY'
  const paused = (skipping && roundTimer.isPaused) || (resting && restTimer.isPaused)
  const timer = skipping ? roundTimer : resting ? restTimer : null
  const track: TimerTrack = timer && timer.isRunning
    ? { durationSec: timer.durationSec, endsAtMs: timer.isPaused ? null : timer.endsAtMs, remainingMs: timer.secondsRemaining * 1000 }
    : { durationSec: skipSession.roundDurSec, endsAtMs: null, remainingMs: skipSession.roundDurSec * 1000 }

  // The whole session left (page 84's NEXT line): this part, then the rounds and rests after it.
  const roundsAfter = Math.max(0, totalRounds - currentRound)
  const leftSec = resting
    ? shownSec + roundsAfter * skipSession.roundDurSec + Math.max(0, roundsAfter - 1) * SKIP_REST_SEC
    : shownSec + roundsAfter * (SKIP_REST_SEC + skipSession.roundDurSec)

  function togglePause() {
    if (skipping) { if (roundTimer.isPaused) resumeRound(); else pauseRound() }
    else if (resting) { if (restTimer.isPaused) resumeRest(); else pauseRest() }
  }
  function skip() {
    if (skipping) endRound()
    else if (resting) nextRound()
  }

  /**
   * A swipe down (page 85): the round or rest from its full length; another
   * within 3 s goes to the part before (lib/timers/bagRound roundsBack). Its
   * bell plays (paused too, so he hears it moved), and the cues and the lock
   * card move with it as at a natural change; paused stays paused. Nothing is
   * logged: a round counts when it ends, and ending it again only replaces
   * its seconds.
   */
  const lastBackAt = useRef<number | null>(null)
  function back() {
    const t = Date.now()
    const step = backStep(lastBackAt.current, t)
    lastBackAt.current = t
    const at: RoundSpot = { round: currentRound - 1, sub: skipping ? 'fighting' : skipPhase === 'rest' ? 'rest' : 'ready' }
    const to = roundsBack(at, step, () => SKIP_REST_SEC)
    if (to.sub === 'ready') return
    const wasPaused = paused
    void cancelRoundActiveCues()
    void cancelRestCues()
    if (to.sub === 'fighting') {
      restTimer.stop()
      roundTimer.restore(freshSnap(wasPaused ? 'paused' : 'running', skipSession.roundDurSec, t))
      soundRoundStart()
      if (!wasPaused) void scheduleRoundCuesUntil(t + skipSession.roundDurSec * 1000, to.round + 1 >= totalRounds ? null : SKIP_REST_SEC)
      setSkipPhase('skipping')
    } else {
      roundTimer.stop()
      restTimer.restore(freshSnap(wasPaused ? 'paused' : 'running', SKIP_REST_SEC, t))
      soundRoundEnd()
      if (!wasPaused) void scheduleRestCuesUntil(t + SKIP_REST_SEC * 1000)
      setSkipPhase('rest')
    }
    setCurrentRound(to.round + 1)
  }

  return (
    <SessionFrame
      title="SKIP ROPE"
      onEnd={onExit}
      paused={paused}
      grass={
        <GrassZone
          track={track}
          kind={resting ? 'rest' : 'work'}
          mode={resting ? 'rest' : skipping ? 'work' : 'ready'}
          heat={heat}
          state={skipPhase === 'ready' ? 'ready' : paused ? 'paused' : 'running'}
          onTap={skipPhase === 'ready' ? startRound : togglePause}
          onSkip={skipPhase === 'ready' ? undefined : skip}
          onBack={skipPhase === 'ready' && currentRound <= 1 ? undefined : back}
        />
      }
    >
      {/* page 84: the word over the clock (120), ROUND / NEXT under it (the pips and the top-bar count go), the NEXT line */}
      <TimerColumn>
        <PhaseWord text={label} tone={resting ? 'teal' : 'gold'} className={heat ? `is-${heat}` : ''} />
        <HeroClock seconds={shownSec} kind={resting ? 'rest' : 'work'} heat={heat} tint={resting ? 'rest' : 'work'} track={track} px={120} />
        {resting
          ? <CountRow label="NEXT" n={Math.min(totalRounds, currentRound + 1)} of={totalRounds} tone="teal" />
          : <CountRow label="ROUND" n={currentRound} of={totalRounds} tone="gold" />}
        <NextLine next={!resting && !isLastRound ? `NEXT · REST ${shortTime(SKIP_REST_SEC)}` : null} left={shortTime(leftSec)} />
      </TimerColumn>
    </SessionFrame>
  )
}
