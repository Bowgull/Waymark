import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { FlapLabel, SessionIcon, type SessionIconKey } from '@/design'
import { GrassZone, SessionButton, SessionFrame, TimerFace, type TimerTrack } from '@/components/timers'
import { mobilitySteps, type MobilityStep } from '@/lib/foundation'
import type { EngineState } from '@/lib/sessionResume'
import { useWakeLock } from '@/lib/wakeLock'

import { useHoldTimer } from './useHoldTimer'
import { holdsGlow } from '@/lib/lockGlow'
import { useSessionLiveActivity, type LiveActivityConfig } from './useSessionLiveActivity'
import './session.css'

interface MobilityExercise {
  id: string
  exerciseId: string
  orderIndex: number
  holdSec: number | null
  sets: number | null
  reps?: number | null
  /** Timed or counted on each side in turn. */
  perSide?: boolean | null
  completed: number
  section?: string | null
  exercise: {
    name: string
    formCues: string | null
    equipment: string | null
    formVideoUrl?: string | null
  } | null
  notes: string | null
}

/** "Left side · Rep 3 of 10", or null when the set is one plain step. */
function stepLabel(step: MobilityStep | undefined): string | null {
  if (!step) return null
  const parts: string[] = []
  if (step.side) parts.push(`${step.side} side`)
  if (step.rep != null && step.reps != null) parts.push(`Rep ${step.rep} of ${step.reps}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

interface MobilityExerciseViewProps {
  exercise: MobilityExercise
  exerciseIndex: number
  totalExercises: number
  /** 1-based set number. */
  currentSet: number
  showSectionHeader?: boolean
  onSetDone: () => void
  /** The session on a flap (FOUNDATION, ZONE 2). */
  title?: string
  /** Hold the × (1.5 s): leave the session (kept in progress, resumable). */
  onExit?: () => void
  /** Zone 2 warm-up: no Live Activity of its own. */
  inline?: boolean
  /**
   * Zone 2 warm-up (e2e minor 23): a timed walk is not a hold. Its icon (the
   * Zone 2 dial, not the Foundation mat) and its words (START, GO, DONE)
   * instead of START HOLD / HOLD / HOLD COMPLETE.
   */
  warmUp?: boolean
  /** Saved step + hold (session resume) for this exercise and set. */
  resume?: Extract<EngineState, { kind: 'hold' }> | null
  /** Called on every change so the session can be resumed exactly here. */
  onPersist?: (state: Extract<EngineState, { kind: 'hold' }>) => void
}

/**
 * A Foundation hold (page 31 "Foundation · per side", page 19 "Mobility hold"):
 * FOUNDATION and n OF m on flaps; the exercise board (the icon, its name, the
 * set and side, its cue); the teal clock with READY / HOLD / HOLD COMPLETE; no
 * start button (page 71): the calm teal grass starts the hold (TAP TO START),
 * pauses it (tap) and ends it early (swipe up); END EARLY while it runs, DONE
 * at the target.
 */
export function MobilityExerciseView({
  title = 'FOUNDATION',
  exercise,
  exerciseIndex,
  totalExercises,
  currentSet,
  onSetDone,
  onExit,
  inline = false,
  warmUp = false,
  resume,
  onPersist,
}: MobilityExerciseViewProps) {
  const icon: SessionIconKey = warmUp ? 'zone2' : 'foundation'
  const totalSets = exercise.sets ?? 1
  // One set can be several timed steps: both sides of a per-side hold, or one
  // hold per rep (prone cobra 10 x 3s). The set is done after the last step.
  // Memoised: a new array each render would restart the auto-advance timer on every tick.
  const steps = useMemo(() => mobilitySteps({ holdSec: exercise.holdSec, reps: exercise.reps, perSide: exercise.perSide }), [exercise.holdSec, exercise.reps, exercise.perSide])
  const [stepIdx, setStepIdx] = useState(() =>
    resume ? Math.min(Math.max(0, resume.stepIdx), Math.max(0, steps.length - 1)) : 0,
  )
  const step = steps[Math.min(stepIdx, steps.length - 1)]
  const isHoldExercise = step.kind === 'hold'
  const holdTimer = useHoldTimer(step.holdSec ?? 0)
  const [activityReadyAtMs] = useState(() => Date.now())
  const [autoStartNext, setAutoStartNext] = useState(false)
  // Page 31 "Switch sides": the side just held stays HOLD COMPLETE (grass full) until the next one starts.
  const [afterComplete, setAfterComplete] = useState(false)

  // Resume: put the saved hold back. A hold whose time ran out while away
  // reaches its target at once and advances one step (the effect below).
  const restoredRef = useRef(false)
  const restoreHold = holdTimer.restore
  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    if (resume?.timer && isHoldExercise) restoreHold(resume.timer)
  }, [isHoldExercise, restoreHold, resume])

  const holdSnapshot = holdTimer.snapshot
  useEffect(() => {
    onPersist?.({ kind: 'hold', stepIdx, timer: holdSnapshot() })
  }, [onPersist, stepIdx, holdSnapshot, holdTimer.running, holdTimer.isPaused, holdTimer.endsAtMs])

  useWakeLock(isHoldExercise && holdTimer.running && !holdTimer.isPaused && !holdTimer.reachedTarget)

  const stopHold = holdTimer.stop
  const holdDone = holdTimer.reachedTarget
  const advanceStep = useCallback(() => {
    stopHold()
    if (stepIdx < steps.length - 1) {
      const next = steps[stepIdx + 1]
      setAfterComplete(holdDone && !(next.side === step.side && next.rep != null))
      // Next rep on the same side starts by itself; a side switch waits for a tap.
      setAutoStartNext(next.side === step.side && next.rep != null)
      setStepIdx(stepIdx + 1)
      return
    }
    onSetDone()
  }, [holdDone, onSetDone, step.side, stepIdx, steps, stopHold])

  const startHold = holdTimer.start
  useEffect(() => {
    if (!autoStartNext) return
    const handle = setTimeout(() => {
      setAutoStartNext(false)
      startHold()
    }, 1500)
    return () => clearTimeout(handle)
  }, [autoStartNext, startHold])

  // Tap-Enter/Space for rep-based exercises
  useEffect(() => {
    if (isHoldExercise) return
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onSetDone()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isHoldExercise, onSetDone])


  // Live Activity for mobility holds. Phases:
  //   hold     — hold is running (possibly paused)
  //   complete — brief ✓ frame when the target is reached, before auto-advance
  //   ready    — between holds, waiting for Start Hold tap on the widget
  const mobilityActivityConfig: LiveActivityConfig | null = (() => {
    if (inline || !isHoldExercise) return null
    // The hold's number in the session (lib/lockGlow): grows hold by hold, exercise by exercise.
    const holdNo = exerciseIndex * 20 + currentSet
    const exerciseName = exercise.exercise?.name ?? 'Hold'
    const detail =
      (exercise.sets ?? 1) > 1
        ? `Set ${currentSet} of ${exercise.sets}`
        : undefined
    if (holdTimer.running && !holdTimer.reachedTarget) {
      return {
        sessionType: 'mobility',
        sessionLabel: 'Foundation',
        state: {
          phase: 'hold',
          label: exerciseName,
          detail,
          ...holdsGlow(holdNo, true),
          startedAt: holdTimer.startedAtMs,
          endsAt: holdTimer.endsAtMs,
          isPaused: holdTimer.isPaused,
          pausedRemaining: holdTimer.isPaused
            ? holdTimer.secondsRemaining
            : undefined,
        },
      }
    }
    // A finished hold mid-session is the lock screen's "time ran out" state
    // (page 44: clay 0:00, skip only), not the session-finish card.
    if (holdTimer.running && holdTimer.reachedTarget) {
      const now = holdTimer.endsAtMs || activityReadyAtMs
      return {
        sessionType: 'mobility',
        sessionLabel: 'Foundation',
        state: {
          phase: 'hold',
          label: exerciseName,
          detail,
          // page 82: the hold ended, the grass flashes once
          ...holdsGlow(holdNo, false),
          startedAt: holdTimer.startedAtMs || now,
          endsAt: now,
          isPaused: false,
        },
      }
    }
    if (!holdTimer.running) {
      const now = activityReadyAtMs
      return {
        sessionType: 'mobility',
        sessionLabel: 'Foundation',
        state: {
          phase: 'ready',
          label: detail ?? 'Next Hold',
          detail: exerciseName,
          exerciseName,
          ...holdsGlow(holdNo, true),
          startedAt: now,
          endsAt: now,
          isPaused: false,
        },
      }
    }
    return null
  })()

  useSessionLiveActivity(mobilityActivityConfig, {
    onPause: (pausedRemainingMs) => {
      if (holdTimer.running && !holdTimer.isPaused) holdTimer.pause(pausedRemainingMs)
    },
    onResume: (newEndsAtMs) => {
      if (holdTimer.running && holdTimer.isPaused) holdTimer.resume(newEndsAtMs)
    },
    onRestart: () => {
      if (isHoldExercise) {
        holdTimer.stop()
        holdTimer.start()
      }
    },
    onEnd: () => {
      // Lock-screen End leaves the session (still in progress, resumable).
      onExit?.()
    },
    onStartHold: () => {
      if (isHoldExercise && !holdTimer.running) {
        holdTimer.start()
      }
    },
    // "Done →" from the lock screen — end the current hold immediately and
    // advance. This is the manual escape hatch when JS is frozen and the
    // auto-advance on reachedTarget can't fire.
    onAdvance: () => {
      if (isHoldExercise && holdTimer.running) advanceStep()
    },
  })

  // Auto-advance when the hold target is reached — mirrors the strength
  // rest-timer auto-advance flow. Brief delay so the "Hold Complete" state
  // registers visually before we flip to the next exercise's ready state.
  const holdReachedTarget = holdTimer.reachedTarget
  const holdRunning = holdTimer.running
  useEffect(() => {
    if (!isHoldExercise) return
    if (!holdReachedTarget || !holdRunning) return
    const handle = setTimeout(advanceStep, 600)
    return () => clearTimeout(handle)
  }, [holdReachedTarget, holdRunning, isHoldExercise, advanceStep])


  // ─── The screen ──────────────────────────────────────────────

  const totalReps = exercise.reps ?? null
  const holdSec = step.holdSec ?? exercise.holdSec ?? 0
  const note = [totalSets > 1 ? `Set ${currentSet} of ${totalSets}` : null, stepLabel(step)].filter(Boolean).join(' · ')
  const cue = exercise.notes
  const board = (
    <div className="wm-board" style={{ margin: '12px 14px 0' }}>
      <div className="ss-row">
        <SessionIcon kind={icon} size={36} />
        <span className="ss-grow"><FlapLabel text={exercise.exercise?.name ?? 'Exercise'} size="md" len={10} fit /></span>
      </div>
      {note && <p className="tm-note" style={{ marginTop: 6 }}>{note}</p>}
      {cue && <p className="wm-prose is-dim" style={{ marginTop: 6 }}>{cue}</p>}
    </div>
  )
  const count = `${exerciseIndex + 1} OF ${totalExercises}`

  if (!isHoldExercise || !holdSec) {
    // Counted (not timed) exercises: no timer, so no grass; the reps on a big flap and DONE.
    return (
      <SessionFrame title={title} count={count} onEnd={onExit}>
        {board}
        <div className="tm-clock is-compact" role="group" aria-label="Reps">
          <FlapLabel text={totalReps ? String(totalReps) : totalSets > 1 ? `${currentSet}/${totalSets}` : '-'} size="xl" />
        </div>
        <div className="tm-phase is-compact">
          <FlapLabel text={totalReps ? (exercise.perSide ? 'REPS EACH SIDE' : 'REPS') : 'SET'} size="md" tone="teal" />
        </div>
        <div className="tm-wide"><SessionButton label="DONE" primary onClick={onSetDone} /></div>
      </SessionFrame>
    )
  }

  const running = holdTimer.running
  const done = running && holdTimer.reachedTarget
  const showComplete = done || (!running && afterComplete)
  const shown = running ? holdTimer.secondsRemaining : holdSec
  const label = showComplete ? (warmUp ? 'DONE' : 'HOLD COMPLETE') : running ? (warmUp ? 'GO' : 'HOLD') : 'READY'
  const track: TimerTrack = running
    ? { durationSec: holdSec, endsAtMs: holdTimer.isPaused || done ? null : holdTimer.endsAtMs, remainingMs: done ? 0 : holdTimer.secondsRemaining * 1000 }
    : { durationSec: holdSec, endsAtMs: null, remainingMs: afterComplete ? 0 : holdSec * 1000 }
  const start = () => { setAutoStartNext(false); setAfterComplete(false); holdTimer.start() }
  // Page 71: the grass is the control. Ready: tap starts. Running: tap pauses / goes on.
  const grassState = !running ? 'ready' : holdTimer.isPaused ? 'paused' : 'running'
  const onGrassTap = !running ? start : !done ? () => (holdTimer.isPaused ? holdTimer.resume() : holdTimer.pause()) : undefined

  return (
    <SessionFrame
      title={title}
      count={count}
      onEnd={onExit}
      paused={running && holdTimer.isPaused}
      grass={
        <GrassZone
          track={track}
          kind="hold"
          state={grassState}
          onTap={onGrassTap}
          onSkip={running ? advanceStep : undefined}
        />
      }
    >
      {board}
      <TimerFace seconds={shown} kind="hold" tone="teal" label={label} labelTone="teal" track={running ? track : undefined} compact />
      {running && (
        <div className="tm-wide">
          {done
            ? <SessionButton label="DONE" primary onClick={advanceStep} />
            : <SessionButton label="END EARLY" onClick={advanceStep} />}
        </div>
      )}
    </SessionFrame>
  )
}
