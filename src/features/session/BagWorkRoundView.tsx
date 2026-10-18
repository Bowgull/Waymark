import { useCallback, useEffect, useRef } from 'react'

import { FlapLabel } from '@/design'
import { ComboStrikes, GrassZone, Pips, SessionButton, SessionFrame, TimerFace, type TimerTrack } from '@/components/timers'
import { heavyHaptic } from '@/lib/haptics'
import {
  soundRoundStart,
  soundRoundEnd,
  soundFinishWarning,
  soundRestWarning,
} from '@/lib/sounds'
import { deactivateSessionAudio } from '@/lib/sessionAudio'
import {
  scheduleRoundCuesUntil,
  scheduleRestCuesUntil,
  cancelRoundActiveCues,
  cancelRestCues,
} from '@/lib/notifications'
import { isStaleCue, type EngineState } from '@/lib/sessionResume'
import { heatFor, workLabel } from '@/lib/timers/timerLook'
import { useWakeLock } from '@/lib/wakeLock'

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

interface RoundData {
  id: string
  roundNumber: number
  durationSec: number
  restSec: number
  roundType?: string | null
  coachRationale?: string | null
  combos: ComboData[]
}

type RoundPhase = 'ready' | 'fighting' | 'rest'

interface BagWorkRoundViewProps {
  round: RoundData
  totalRounds: number
  /** The round after this one: its combos flip in on the rest board (NEXT ROUND). */
  nextRound?: RoundData | null
  /** Each combo's letter for the session (A, B, C…): the preview, the timer and the rating card share them. */
  letters?: Map<string, string>
  phase: RoundPhase
  onPhaseChange: (phase: RoundPhase) => void
  onNextRound: () => void
  onComplete: () => void
  /** Hold the × (1.5 s): leave the session (kept in progress, resumable). */
  onExit?: () => void
  /** Saved state to come back to (session resume), already brought up to now. */
  resume?: Extract<EngineState, { kind: 'rounds' }> | null
  /** Called on every change so the session can be resumed exactly here. */
  onPersist?: (state: Extract<EngineState, { kind: 'rounds' }>) => void
  /** A round ended: its index (0-based) and the seconds actually worked (the done summary's per-round lines). */
  onRoundDone?: (roundIndex: number, actualSec: number) => void
}

/**
 * A bag round (page 19, "The round · calmer"; gym mode A, the half-screen zone):
 * BAG WORK and the round on flaps, pips, the calm flap clock, FIGHT (FINISH with
 * the yellow, orange, red heat in the last 10 s), the combo on big strike tiles,
 * and the grass. Rest turns everything teal: REST, and the board reads NEXT ROUND
 * with the next combo flipped in. Tap the grass to pause, swipe up to skip to the
 * next phase, hold the × to end.
 */
export function BagWorkRoundView({
  round,
  totalRounds,
  nextRound,
  letters,
  phase,
  onPhaseChange,
  onNextRound,
  onComplete,
  onExit,
  resume,
  onPersist,
  onRoundDone,
}: BagWorkRoundViewProps) {
  const roundTimer = useRestTimer()
  const restTimer = useRestTimer()

  const isLastRound = round.roundNumber >= totalRounds
  const roundIndex = round.roundNumber - 1

  // Cues duck other audio only while they play (lib/sessionAudio); make sure
  // nothing is left ducked when the view goes.
  useEffect(() => {
    return () => { void deactivateSessionAudio() }
  }, [])

  // Resume: put the saved timer back and re-sync the scheduled cues to its
  // real end time (stale ones cancelled, the rest rescheduled).
  const restoredRef = useRef(false)
  const restoreRound = roundTimer.restore
  const restoreRest = restTimer.restore
  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    if (!resume || resume.round !== roundIndex || !resume.timer) return
    const t = resume.timer
    if (resume.sub === 'fighting') {
      restoreRound(t)
      if (t.state === 'running') void scheduleRoundCuesUntil(t.endsAtMs, isLastRound ? null : round.restSec)
      else { void cancelRoundActiveCues(); void cancelRestCues() }
    } else if (resume.sub === 'rest') {
      restoreRest(t)
      void cancelRoundActiveCues()
      if (t.state === 'running') void scheduleRestCuesUntil(t.endsAtMs)
      else void cancelRestCues()
    }
  }, [isLastRound, restoreRest, restoreRound, resume, round.restSec, roundIndex])

  // Save on every change: phase and the running timer's end (or what is left).
  const roundSnapshot = roundTimer.snapshot
  const restSnapshot = restTimer.snapshot
  useEffect(() => {
    onPersist?.({
      kind: 'rounds',
      round: roundIndex,
      sub: phase,
      timer: phase === 'fighting' ? roundSnapshot() : phase === 'rest' ? restSnapshot() : null,
    })
  }, [onPersist, phase, roundIndex, roundSnapshot, restSnapshot, roundTimer.isRunning, roundTimer.isPaused, roundTimer.endsAtMs, restTimer.isRunning, restTimer.isPaused, restTimer.endsAtMs])

  useWakeLock(
    (phase === 'fighting' && roundTimer.isRunning && !roundTimer.isPaused) ||
    (phase === 'rest' && restTimer.isRunning && !restTimer.isPaused),
  )

  function handleStartRound() {
    heavyHaptic()
    soundRoundStart()
    roundTimer.start(round.durationSec)
    // The whole round + rest timeline at once: JS sleeps while locked.
    void scheduleRoundCuesUntil(Date.now() + round.durationSec * 1000, isLastRound ? null : round.restSec)
    onPhaseChange('fighting')
  }

  /**
   * `natural`: the round's time ran out. Its rest then starts at the round's
   * real end (not when JS woke up), and a cue that is long past is not played.
   */
  const handleRoundEnd = useCallback((natural = false) => {
    const endedAt = natural && roundTimer.endsAtMs > 0 ? roundTimer.endsAtMs : Date.now()
    if (!natural || !isStaleCue(endedAt, Date.now())) soundRoundEnd()
    onRoundDone?.(roundIndex, natural ? round.durationSec : Math.max(0, Math.min(round.durationSec, round.durationSec - Math.max(0, roundTimer.secondsRemaining))))
    roundTimer.stop()
    void cancelRoundActiveCues()
    if (isLastRound) {
      void cancelRestCues()
      onComplete()
    } else {
      restTimer.startFrom(endedAt, round.restSec)
      // Ended early: the rest cues scheduled at round start are now wrong.
      if (!natural) void scheduleRestCuesUntil(endedAt + round.restSec * 1000)
      onPhaseChange('rest')
    }
  }, [isLastRound, onComplete, onPhaseChange, onRoundDone, restTimer, round.durationSec, round.restSec, roundIndex, roundTimer])

  const handleRestDone = useCallback((natural = false) => {
    if (natural && !isStaleCue(restTimer.endsAtMs, Date.now())) soundRoundStart()
    restTimer.stop()
    void cancelRestCues()
    onNextRound()
  }, [onNextRound, restTimer])

  useEffect(() => {
    // Use <= 0 so a locked-screen jump past zero still fires
    if (phase === 'fighting' && roundTimer.secondsRemaining <= 0 && roundTimer.isRunning && !roundTimer.isPaused) {
      handleRoundEnd(true)
    }
  }, [handleRoundEnd, roundTimer.secondsRemaining, roundTimer.isRunning, roundTimer.isPaused, phase])

  // Last 10 seconds of round — finish warning (screen on only; notification handles locked)
  useEffect(() => {
    if (phase === 'fighting' && roundTimer.secondsRemaining === 10) {
      soundFinishWarning()
    }
  }, [roundTimer.secondsRemaining, phase])

  // Auto-advance rest timer
  useEffect(() => {
    if (phase === 'rest' && restTimer.secondsRemaining <= 0 && restTimer.isRunning && !restTimer.isPaused) {
      handleRestDone(true)
    }
  }, [handleRestDone, restTimer.secondsRemaining, restTimer.isRunning, restTimer.isPaused, phase])

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

  function pauseRound(pausedRemainingMs?: number) {
    void cancelRoundActiveCues()
    void cancelRestCues()
    roundTimer.pause(pausedRemainingMs)
  }
  function resumeRound(newEndsAtMs?: number) {
    const endsAt = roundTimer.resume(newEndsAtMs)
    if (endsAt > Date.now()) void scheduleRoundCuesUntil(endsAt, isLastRound ? null : round.restSec)
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
    if (phase === 'fighting') {
      roundTimer.start(round.durationSec)
      void scheduleRoundCuesUntil(Date.now() + round.durationSec * 1000, isLastRound ? null : round.restSec)
    } else if (phase === 'rest') {
      restTimer.start(round.restSec)
      void scheduleRestCuesUntil(Date.now() + round.restSec * 1000)
    }
  }

  useSessionLiveActivity(activityConfig, {
    onPause: (pausedRemainingMs) => {
      if (phase === 'fighting') pauseRound(pausedRemainingMs)
      else if (phase === 'rest') pauseRest(pausedRemainingMs)
    },
    onResume: (newEndsAtMs) => {
      if (phase === 'fighting') resumeRound(newEndsAtMs)
      else if (phase === 'rest') resumeRest(newEndsAtMs)
    },
    onRestart: restartCurrentPhase,
    onEnd: () => {
      // Lock-screen End leaves the session (still in progress, resumable).
      onExit?.()
    },
    // "Next →" from the lock screen: fighting → end round early, rest →
    // jump to next round. Mirrors the in-app footer actions.
    onAdvance: () => {
      if (phase === 'fighting') handleRoundEnd()
      else if (phase === 'rest') handleRestDone()
    },
  })


  // ─── The screen ──────────────────────────────────────────────

  const fighting = phase === 'fighting'
  const resting = phase === 'rest'
  const shownSec = fighting ? Math.max(0, roundTimer.secondsRemaining) : resting ? Math.max(0, restTimer.secondsRemaining) : round.durationSec
  const heat = fighting ? heatFor(shownSec) : null
  const label = resting ? 'REST' : fighting ? workLabel('FIGHT', shownSec) : 'READY'
  const paused = (fighting && roundTimer.isPaused) || (resting && restTimer.isPaused)
  const timer = fighting ? roundTimer : resting ? restTimer : null
  const track: TimerTrack = timer && timer.isRunning
    ? { durationSec: timer.durationSec, endsAtMs: timer.isPaused ? null : timer.endsAtMs, remainingMs: timer.secondsRemaining * 1000 }
    : { durationSec: round.durationSec, endsAtMs: null, remainingMs: round.durationSec * 1000 }
  const boardRound = resting && nextRound ? nextRound : round
  const combos = boardRound.combos.filter(rc => rc.combo)

  function togglePause() {
    if (fighting) { if (roundTimer.isPaused) resumeRound(); else pauseRound() }
    else if (resting) { if (restTimer.isPaused) resumeRest(); else pauseRest() }
  }
  function skip() {
    if (fighting) handleRoundEnd()
    else if (resting) handleRestDone()
  }

  return (
    <SessionFrame
      title="BAG WORK"
      count={`${round.roundNumber}/${totalRounds}`}
      onEnd={onExit}
      paused={paused}
      grass={
        <GrassZone
          track={track}
          kind={resting ? 'rest' : 'work'}
          mode={resting ? 'rest' : fighting ? 'work' : 'ready'}
          heat={heat}
          onTap={phase === 'ready' ? undefined : togglePause}
          onSkip={phase === 'ready' ? undefined : skip}
        />
      }
    >
      <Pips total={totalRounds} now={round.roundNumber - 1} />
      <TimerFace
        seconds={shownSec}
        kind={resting ? 'rest' : 'work'}
        heat={heat}
        tone={resting ? 'teal' : 'ink'}
        label={label}
        labelTone={resting ? 'teal' : 'gold'}
        track={track}
      />
      {combos.length > 0 && (
        <div className={`wm-board tm-next${resting ? ' is-rest' : ''}`}>
          <span className="wm-label tm-nlab">{resting ? 'Next round' : 'Combo'}</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {combos.map(rc => (
              <ComboStrikes key={rc.id} text={rc.combo!.text} letter={letters?.get(rc.combo!.id)} size="md" timer />
            ))}
          </div>
        </div>
      )}
      {phase === 'ready' && (
        <div className="tm-wide">
          <SessionButton label="START ROUND" primary onClick={handleStartRound} />
        </div>
      )}
      {paused && <span className="sr-only" role="status"><FlapLabel text="PAUSED" size="xs" /></span>}
    </SessionFrame>
  )
}
