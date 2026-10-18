import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { RingTimer } from '@/components/RingTimer'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api'
import {
  FOAM_ROLLING_AREAS,
  HIP_MOBILITY_MOVEMENTS,
  type FoamRollingArea,
  type HipMobilityMovement,
} from '@/lib/activeRecoveryTemplate'
import { logger } from '@/lib/logger'
import {
  advanceRoll,
  timerPause,
  timerRemainingMs,
  timerResume,
  timerStart,
  type EngineState,
  type RecoveryPhase,
  type TimerSnap,
} from '@/lib/sessionResume'
import { useWakeLock } from '@/lib/wakeLock'

import { resolveActiveRecoveryMoment } from './activeRecoveryMicrocopy'
import { SessionShell } from './SessionShell'
import { useSessionLiveActivity, type LiveActivityConfig } from './useSessionLiveActivity'

interface RecoverySession {
  id: string
  hipMobility: number
  foamRolling: number
}

type RecoveryState = Extract<EngineState, { kind: 'recovery' }>

interface ActiveRecoveryViewProps {
  recoverySession: RecoverySession
  onComplete: () => void
  onExit?: () => void
  /** Saved block, step and timers (session resume). */
  resume?: RecoveryState | null
  /** Called on every change so the session can be resumed exactly here. */
  onPersist?: (state: RecoveryState) => void
}

type Phase = RecoveryPhase

const ACCENT = '#4ACAAA'

// ────────── Persistence helper ──────────

async function persistBlockComplete(
  id: string,
  field: 'hipMobility' | 'foamRolling',
) {
  try {
    await apiFetch(`/api/recovery-sessions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ [field]: 1 }),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logger.warn('session', `recovery ${field} persist failed`, { message }, `PATCH recovery session ${field} field failed. UI advanced anyway.`)
  }
}

// ────────── Foam rolling step list ──────────

interface RollStep {
  area: FoamRollingArea
  side: 'left' | 'right' | null
  areaIndex: number
}

function buildRollSteps(): RollStep[] {
  const steps: RollStep[] = []
  FOAM_ROLLING_AREAS.forEach((area, areaIndex) => {
    if (area.bilateral) {
      steps.push({ area, side: 'left', areaIndex })
      steps.push({ area, side: 'right', areaIndex })
    } else {
      steps.push({ area, side: null, areaIndex })
    }
  })
  return steps
}

// ────────── Hip mobility step list ──────────

interface HipStep {
  movement: HipMobilityMovement
  side: 'left' | 'right' | null
  index: number
}

function buildHipSteps(): HipStep[] {
  const steps: HipStep[] = []
  HIP_MOBILITY_MOVEMENTS.forEach((m, index) => {
    if (m.bilateral) {
      steps.push({ movement: m, side: 'left', index })
      steps.push({ movement: m, side: 'right', index })
    } else {
      steps.push({ movement: m, side: null, index })
    }
  })
  return steps
}

// ────────── Main view ──────────

export function ActiveRecoveryView({
  recoverySession,
  onComplete,
  onExit,
  resume,
  onPersist,
}: ActiveRecoveryViewProps) {
  const hipDonePersisted = recoverySession.hipMobility === 1
  const foamDonePersisted = recoverySession.foamRolling === 1

  const [phase, setPhase] = useState<Phase>(() =>
    resume
      ? resume.phase
      : hipDonePersisted && foamDonePersisted
        ? 'done'
        : hipDonePersisted
          ? 'roll-intro'
          : 'intro',
  )

  // Both blocks' timers are wall-clock anchored (end time stored), not
  // decremented by an interval: they used to freeze while locked and drift
  // from the Live Activity.
  const hipSteps = useMemo(() => buildHipSteps(), [])
  const rollSteps = useMemo(() => buildRollSteps(), [])
  const rollSecs = useMemo(() => rollSteps.map(st => st.area.sec), [rollSteps])
  const [hipIdx, setHipIdx] = useState(() => Math.min(resume?.hipIdx ?? 0, hipSteps.length - 1))
  const [hipTimer, setHipTimer] = useState<TimerSnap | null>(() => resume?.hipTimer ?? null)
  const [baseRollIdx, setRollIdx] = useState(() => Math.min(resume?.rollIdx ?? 0, rollSteps.length - 1))
  const [baseRollTimer, setRollTimer] = useState<TimerSnap | null>(() => resume?.rollTimer ?? null)
  const [nowMs, setNowMs] = useState(() => Date.now())

  // Foam rolling: zone to zone; each zone starts when the last one ended,
  // so a locked phone or a reload lands on the right zone. Derived from the
  // stored zone + timer and the clock, so nothing ticks.
  const rollNow = phase === 'roll'
    ? advanceRoll(rollSecs, baseRollIdx, baseRollTimer, nowMs)
    : { rollIdx: baseRollIdx, timer: baseRollTimer, finished: false }
  const rollIdx = rollNow.rollIdx
  const rollTimer = rollNow.timer

  const currentHipStep = hipSteps[hipIdx]
  const currentRollStep = rollSteps[rollIdx]

  const ticking = hipTimer?.state === 'running' || rollTimer?.state === 'running'
  useEffect(() => {
    if (!ticking) return
    const id = setInterval(() => setNowMs(Date.now()), 250)
    return () => clearInterval(id)
  }, [ticking])
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') setNowMs(Date.now())
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  // Hip hold
  const hipHoldSec = currentHipStep?.movement.holdSec ?? 0
  const hipRunning = hipTimer != null
  const hipPaused = hipTimer?.state === 'paused'
  const hipRemainingMs = hipTimer ? Math.max(0, timerRemainingMs(hipTimer, nowMs)) : hipHoldSec * 1000
  const hipSecondsLeft = Math.ceil(hipRemainingMs / 1000)
  const hipReachedTarget =
    currentHipStep?.movement.mode === 'hold' && hipHoldSec > 0 && hipRunning && hipRemainingMs <= 0

  const rollPaused = rollTimer?.state === 'paused'
  const rollRemainingMs = rollTimer ? Math.max(0, timerRemainingMs(rollTimer, nowMs)) : (currentRollStep?.area.sec ?? 0) * 1000
  const rollSecondsLeft = Math.ceil(rollRemainingMs / 1000)
  const isLastRollStep = rollIdx >= rollSteps.length - 1
  const rollReachedTarget = rollRemainingMs <= 0 && isLastRollStep && rollTimer != null

  // Save on every change.
  useEffect(() => {
    onPersist?.({ kind: 'recovery', phase, hipIdx, hipTimer, rollIdx, rollTimer })
  }, [onPersist, phase, hipIdx, hipTimer, rollIdx, rollTimer])

  useWakeLock(
    (phase === 'hip' && hipRunning && !hipPaused && !hipReachedTarget) ||
    (phase === 'roll' && rollTimer != null && !rollPaused && !rollReachedTarget),
  )

  // ───── Handlers ─────

  function startHipBlock() {
    setPhase('hip')
    setHipIdx(0)
    setHipTimer(null)
  }

  function startHipHold() {
    setNowMs(Date.now())
    setHipTimer(timerStart(hipHoldSec, Date.now()))
  }

  function toggleHipPause(pausedRemainingMs?: number) {
    const now = Date.now()
    setNowMs(now)
    setHipTimer(t => (!t ? t : t.state === 'paused' ? timerResume(t, now) : timerPause(t, now, pausedRemainingMs)))
  }

  function advanceHip() {
    setHipTimer(null)
    if (hipIdx >= hipSteps.length - 1) {
      logger.sessionEvent('recovery hip mobility complete', {
        recoveryId: recoverySession.id,
      })
      void persistBlockComplete(recoverySession.id, 'hipMobility')
      setPhase('roll-intro')
      return
    }
    setHipIdx((i) => i + 1)
  }

  function startRolling() {
    setNowMs(Date.now())
    setRollIdx(0)
    setRollTimer(timerStart(rollSteps[0]?.area.sec ?? 0, Date.now()))
    setPhase('roll')
  }

  const toggleRollPause = useCallback((pausedRemainingMs?: number) => {
    const now = Date.now()
    // Commit the derived zone first: pausing freezes the zone it is on now.
    const cur = advanceRoll(rollSecs, baseRollIdx, baseRollTimer, now)
    setNowMs(now)
    setRollIdx(cur.rollIdx)
    setRollTimer(!cur.timer ? cur.timer : cur.timer.state === 'paused' ? timerResume(cur.timer, now) : timerPause(cur.timer, now, pausedRemainingMs))
  }, [baseRollIdx, baseRollTimer, rollSecs])

  function finishFoam() {
    logger.sessionEvent('recovery foam rolling complete', {
      recoveryId: recoverySession.id,
    })
    void persistBlockComplete(recoverySession.id, 'foamRolling')
    setRollTimer(null)
    setPhase('done')
  }

  function skipRollZone() {
    if (isLastRollStep) {
      finishFoam()
      return
    }
    const next = Math.min(rollIdx + 1, rollSteps.length - 1)
    setNowMs(Date.now())
    setRollIdx(next)
    setRollTimer(timerStart(rollSteps[next].area.sec, Date.now()))
  }

  // ───── Render helpers ─────

  const hipMovementHasTimer = currentHipStep?.movement.mode === 'hold'

  const moment = resolveActiveRecoveryMoment({
    phase:
      phase === 'intro'
        ? 'intro'
        : phase === 'roll-intro'
          ? 'roll-intro'
          : phase === 'done'
            ? 'complete'
            : phase === 'roll'
              ? 'rolling'
              : // hip phase — depends on whether we're running the timer or doing reps
                hipMovementHasTimer
                ? hipRunning
                  ? 'hip-holding'
                  : 'hip-ready'
                : 'hip-reps',
    secondsRemaining:
      phase === 'roll'
        ? rollSecondsLeft
        : phase === 'hip' && hipRunning
          ? hipSecondsLeft
          : undefined,
  })

  // Progress: 2 blocks (Hip, Foam Rolling)
  const hipBlockDone = phase === 'roll-intro' || phase === 'roll' || phase === 'done'
  const foamBlockDone = phase === 'done'
  const progress = {
    completed: (hipBlockDone ? 1 : 0) + (foamBlockDone ? 1 : 0),
    active:
      phase === 'intro' || phase === 'hip'
        ? 0
        : 1,
    total: 2,
  }

  // Live Activity for recovery timers: the same end times the app uses.
  const hipLiveConfig: LiveActivityConfig | null =
    phase === 'hip' && hipTimer && !hipReachedTarget && currentHipStep
      ? {
          sessionType: 'recovery',
          sessionLabel: 'Recovery',
          state: {
            phase: 'hold',
            label: currentHipStep.movement.name,
            detail: currentHipStep.side
              ? currentHipStep.side === 'left' ? 'Left side' : 'Right side'
              : undefined,
            startedAt: hipTimer.state === 'running' ? hipTimer.startedAtMs : nowMs + hipTimer.remainingMs - hipHoldSec * 1000,
            endsAt: hipTimer.state === 'running' ? hipTimer.endsAtMs : nowMs + hipTimer.remainingMs,
            isPaused: hipPaused,
            pausedRemaining: hipPaused ? hipSecondsLeft : undefined,
          },
        }
      : null

  const rollLiveConfig: LiveActivityConfig | null =
    phase === 'roll' && currentRollStep && rollTimer
      ? {
          sessionType: 'recovery',
          sessionLabel: 'Recovery',
          state: {
            phase: 'active',
            label: currentRollStep.area.name,
            detail: currentRollStep.side
              ? currentRollStep.side === 'left' ? 'Left side' : 'Right side'
              : undefined,
            startedAt: rollTimer.state === 'running' ? rollTimer.startedAtMs : nowMs + rollTimer.remainingMs - currentRollStep.area.sec * 1000,
            endsAt: rollTimer.state === 'running' ? rollTimer.endsAtMs : nowMs + rollTimer.remainingMs,
            isPaused: rollPaused,
            pausedRemaining: rollPaused ? rollSecondsLeft : undefined,
          },
        }
      : null

  useSessionLiveActivity(hipLiveConfig ?? rollLiveConfig, {
    onPause: (pausedRemainingMs) => {
      if (phase === 'roll' && rollTimer?.state === 'running') toggleRollPause(pausedRemainingMs)
      else if (phase === 'hip' && hipTimer?.state === 'running') toggleHipPause(pausedRemainingMs)
    },
    onResume: (newEndsAtMs) => {
      const now = Date.now()
      setNowMs(now)
      if (phase === 'roll') setRollTimer(rollTimer && rollTimer.state === 'paused' ? timerResume(rollTimer, now, newEndsAtMs) : rollTimer)
      else if (phase === 'hip') setHipTimer(t => (t && t.state === 'paused' ? timerResume(t, now, newEndsAtMs) : t))
    },
    onRestart: () => {
      if (phase === 'hip' && currentHipStep) {
        startHipHold()
      } else if (phase === 'roll' && currentRollStep) {
        setNowMs(Date.now())
        setRollIdx(rollIdx)
        setRollTimer(timerStart(currentRollStep.area.sec, Date.now()))
      }
    },
    onEnd: () => {
      // Lock-screen End leaves the session (still in progress, resumable).
      onExit?.()
    },
    // "Next →" / "Skip →" from the lock screen.
    // hip → advance to next hip step (or roll-intro);
    // roll → skip zone, or finish on last.
    onAdvance: () => {
      if (phase === 'hip') advanceHip()
      else if (phase === 'roll') skipRollZone()
    },
  })

  // Counter
  let counter: string | undefined
  if (phase === 'hip' && currentHipStep) {
    counter = `Hip ${currentHipStep.index + 1} of ${HIP_MOBILITY_MOVEMENTS.length}`
  } else if (phase === 'roll' && currentRollStep) {
    counter = `Roll ${currentRollStep.areaIndex + 1} of ${FOAM_ROLLING_AREAS.length}`
  } else if (phase === 'intro' || phase === 'hip') {
    counter = 'Hip Mobility'
  } else if (phase === 'roll-intro') {
    counter = 'Foam Rolling'
  } else if (phase === 'done') {
    counter = 'Complete'
  }

  // ───── Body + footer per phase ─────

  let body: ReactNode
  let footer: ReactNode

  if (phase === 'intro') {
    body = (
      <div className="mx-auto max-w-md animate-fade-in">
        <h2 className="text-display-lg leading-[1.1] text-foreground">
          Active Recovery
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-foreground/85">
          Two short blocks: hip mobility, then foam rolling. Move slow, breathe
          deep, let the body reset.
        </p>

        <div className="mt-6 space-y-3">
          <div className="rounded-2xl border border-gold/15 bg-deep-forest/60 p-4 shadow-[inset_0_1px_0_rgba(232,200,96,0.06)]">
            <p className="font-cinzel text-[11px] uppercase tracking-[0.28em] text-gold/60">
              Block 1
            </p>
            <p className="mt-1 font-medium text-foreground">Hip Mobility</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {HIP_MOBILITY_MOVEMENTS.length} movements. Guided one at a time.
            </p>
          </div>
          <div className="rounded-2xl border border-gold/15 bg-deep-forest/60 p-4 shadow-[inset_0_1px_0_rgba(232,200,96,0.06)]">
            <p className="font-cinzel text-[11px] uppercase tracking-[0.28em] text-gold/60">
              Block 2
            </p>
            <p className="mt-1 font-medium text-foreground">Foam Rolling</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {FOAM_ROLLING_AREAS.length} areas. Auto-advancing timer.
            </p>
          </div>
        </div>
      </div>
    )
    footer = (
      <Button
        onClick={startHipBlock}
        size="lg"
        className="w-full"
        style={{ backgroundColor: ACCENT, color: '#020A08' }}
      >
        Begin
      </Button>
    )
  } else if (phase === 'hip' && currentHipStep) {
    const movement = currentHipStep.movement
    const side = currentHipStep.side
    body = (
      <div className="mx-auto flex max-w-md flex-col animate-fade-in">
        <p className="font-cinzel text-[11px] uppercase tracking-[0.28em] text-gold/60">
          Hip Mobility · {currentHipStep.index + 1} of{' '}
          {HIP_MOBILITY_MOVEMENTS.length}
        </p>
        <h2 className="mt-1 text-display-lg leading-[1.1] text-foreground">
          {movement.name}
        </h2>
        {side && (
          <p className="mt-1 font-cinzel text-sm uppercase tracking-[0.2em] text-gold/60">
            {side === 'left' ? 'Left side' : 'Right side'}
          </p>
        )}
        <p className="mt-3 text-sm leading-relaxed text-foreground/85">
          {movement.cue}
        </p>

        <div className="mt-8 flex justify-center">
          {movement.mode === 'hold' && movement.holdSec ? (
            <div className="rounded-2xl border border-teal/20 bg-deep-forest/60 p-5 shadow-[inset_0_1px_0_rgba(74,202,170,0.08)]">
              <RingTimer
                totalSeconds={movement.holdSec}
                secondsRemaining={hipRunning ? hipSecondsLeft : movement.holdSec}
                label={
                  hipReachedTarget ? 'Done' : hipRunning ? 'Hold' : 'Ready'
                }
                accentColor={ACCENT}
                isComplete={hipReachedTarget}
                isPaused={hipPaused}
                onTogglePause={
                  hipRunning && !hipReachedTarget
                    ? () => toggleHipPause()
                    : undefined
                }
              />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-gold/15 bg-deep-forest/50 px-10 py-8">
              <p className="font-cinzel text-[11px] uppercase tracking-[0.28em] text-gold/60">
                Reps
              </p>
              <p
                className="text-timer text-foreground"
                style={{ fontSize: '3.5rem' }}
              >
                {movement.reps}
              </p>
              <p className="text-xs text-muted-foreground">
                Tap done when the set is complete.
              </p>
            </div>
          )}
        </div>
      </div>
    )

    if (movement.mode === 'hold') {
      const holdSec = movement.holdSec ?? 0
      if (!hipRunning && holdSec > 0) {
        footer = (
          <Button
            onClick={startHipHold}
            size="lg"
            className="w-full"
            style={{
              background:
                'linear-gradient(180deg, #4ACAAA 0%, #1E8A68 100%)',
              color: '#020A08',
            }}
          >
            Start Hold
          </Button>
        )
      } else {
        footer = (
          <Button
            onClick={advanceHip}
            size="lg"
            className="w-full"
            variant={hipReachedTarget ? 'default' : 'secondary'}
            style={
              hipReachedTarget
                ? { backgroundColor: ACCENT, color: '#020A08' }
                : undefined
            }
          >
            {hipReachedTarget ? 'Next' : 'End Early'}
          </Button>
        )
      }
    } else {
      footer = (
        <Button
          onClick={advanceHip}
          size="lg"
          className="w-full"
          style={{ backgroundColor: ACCENT, color: '#020A08' }}
        >
          Done
        </Button>
      )
    }
  } else if (phase === 'roll-intro') {
    body = (
      <div className="mx-auto max-w-md animate-fade-in">
        <h2 className="text-display-lg leading-[1.1] text-foreground">
          Foam Rolling
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-foreground/85">
          The timer cycles through {FOAM_ROLLING_AREAS.length} areas. Pause any
          time. Skip to jump ahead.
        </p>
        <div className="mt-6 rounded-2xl border border-gold/15 bg-deep-forest/60 p-4 shadow-[inset_0_1px_0_rgba(232,200,96,0.06)]">
          <p className="font-cinzel text-[11px] uppercase tracking-[0.28em] text-gold/60">
            First Zone
          </p>
          <p className="mt-1 font-medium text-foreground">
            {rollSteps[0]?.area.name}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {rollSteps[0]?.area.sec}s per zone.
          </p>
        </div>
      </div>
    )
    footer = (
      <Button
        onClick={startRolling}
        size="lg"
        className="w-full"
        style={{ backgroundColor: ACCENT, color: '#020A08' }}
      >
        Start Timer
      </Button>
    )
  } else if (phase === 'roll' && currentRollStep) {
    body = (
      <div className="mx-auto flex max-w-md flex-col items-center animate-fade-in">
        <p className="font-cinzel text-[11px] uppercase tracking-[0.28em] text-gold/60">
          Foam Rolling · {currentRollStep.areaIndex + 1} of{' '}
          {FOAM_ROLLING_AREAS.length}
        </p>
        <h2 className="mt-1 text-display-lg text-center leading-[1.1] text-foreground">
          {currentRollStep.area.name}
        </h2>
        {currentRollStep.side && (
          <p className="mt-1 font-cinzel text-sm uppercase tracking-[0.2em] text-gold/60">
            {currentRollStep.side === 'left' ? 'Left side' : 'Right side'}
          </p>
        )}
        <p className="mt-3 text-center text-sm leading-relaxed text-foreground/85">
          {currentRollStep.area.cue}
        </p>

        <div className="mt-8 rounded-2xl border border-teal/20 bg-deep-forest/60 p-5 shadow-[inset_0_1px_0_rgba(74,202,170,0.08)]">
          <RingTimer
            totalSeconds={currentRollStep.area.sec}
            secondsRemaining={rollSecondsLeft}
            label={rollPaused ? undefined : 'Rolling'}
            accentColor={ACCENT}
            isComplete={rollReachedTarget}
            isPaused={rollPaused}
            onTogglePause={
              rollReachedTarget ? undefined : () => toggleRollPause()
            }
          />
        </div>
      </div>
    )
    footer = (
      <div className="flex w-full gap-2">
        <Button
          onClick={() => toggleRollPause()}
          size="lg"
          variant="secondary"
          className="flex-1"
        >
          {rollPaused ? 'Resume' : 'Pause'}
        </Button>
        <Button
          onClick={skipRollZone}
          size="lg"
          className="flex-1"
          style={{ backgroundColor: ACCENT, color: '#020A08' }}
        >
          {isLastRollStep ? 'Finish' : 'Skip'}
        </Button>
      </div>
    )
  } else {
    // done
    body = (
      <div className="mx-auto max-w-md animate-fade-in text-center">
        <h2 className="text-display-lg leading-[1.1] text-foreground">
          All Done
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-foreground/85">
          Hip mobility and foam rolling complete. Water, food, sleep.
        </p>
      </div>
    )
    footer = (
      <Button
        onClick={onComplete}
        size="lg"
        className="w-full"
        style={{ backgroundColor: ACCENT, color: '#020A08' }}
      >
        Finish
      </Button>
    )
  }

  return (
    <SessionShell
      sessionType="active_recovery"
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
