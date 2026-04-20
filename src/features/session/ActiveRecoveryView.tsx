import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

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

import { resolveActiveRecoveryMoment } from './activeRecoveryMicrocopy'
import { SessionShell } from './SessionShell'
import { useSessionLiveActivity, type LiveActivityConfig } from './useSessionLiveActivity'

interface RecoverySession {
  id: string
  hipMobility: number
  foamRolling: number
}

interface ActiveRecoveryViewProps {
  recoverySession: RecoverySession
  onComplete: () => void
  onExit?: () => void
}

type Phase = 'intro' | 'hip' | 'roll-intro' | 'roll' | 'done'

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
    logger.warn('session', `recovery ${field} persist failed`, { message })
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
}: ActiveRecoveryViewProps) {
  const hipDonePersisted = recoverySession.hipMobility === 1
  const foamDonePersisted = recoverySession.foamRolling === 1

  const [phase, setPhase] = useState<Phase>(
    hipDonePersisted && foamDonePersisted
      ? 'done'
      : hipDonePersisted
        ? 'roll-intro'
        : 'intro',
  )

  // Hip mobility state
  const hipSteps = useMemo(() => buildHipSteps(), [])
  const [hipIdx, setHipIdx] = useState(0)
  const [hipRunning, setHipRunning] = useState(false)
  const [hipPaused, setHipPaused] = useState(false)
  const [hipSecondsLeft, setHipSecondsLeft] = useState(
    hipSteps[0]?.movement.holdSec ?? 0,
  )
  const [hipStartedAtMs, setHipStartedAtMs] = useState(0)
  const hipIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const currentHipStep = hipSteps[hipIdx]

  // Reset hip timer when step changes — render-phase reset (no effect needed).
  // Setting hipRunning to false triggers the tick effect's cleanup, which
  // handles clearing the interval.
  const [prevHipIdx, setPrevHipIdx] = useState(hipIdx)
  if (prevHipIdx !== hipIdx) {
    setPrevHipIdx(hipIdx)
    setHipRunning(false)
    setHipPaused(false)
    setHipSecondsLeft(currentHipStep?.movement.holdSec ?? 0)
  }

  // Clear hip interval on unmount
  useEffect(() => {
    return () => {
      if (hipIntervalRef.current) clearInterval(hipIntervalRef.current)
    }
  }, [])

  // Tick hip timer
  useEffect(() => {
    if (!hipRunning) {
      setHipStartedAtMs(0)
      return
    }
    if (hipPaused) return
    setHipStartedAtMs(Date.now())
    hipIntervalRef.current = setInterval(() => {
      setHipSecondsLeft((s) => {
        if (s <= 1) {
          if (hipIntervalRef.current) clearInterval(hipIntervalRef.current)
          setHipRunning(false)
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => {
      if (hipIntervalRef.current) clearInterval(hipIntervalRef.current)
    }
  }, [hipRunning, hipPaused])

  const hipReachedTarget =
    currentHipStep?.movement.mode === 'hold'
      ? !hipRunning &&
        hipSecondsLeft === 0 &&
        (currentHipStep.movement.holdSec ?? 0) > 0
      : false

  // Foam rolling state
  const rollSteps = useMemo(() => buildRollSteps(), [])
  const [rollIdx, setRollIdx] = useState(0)
  const [rollSecondsLeft, setRollSecondsLeft] = useState(
    rollSteps[0]?.area.sec ?? 0,
  )
  const [rollPaused, setRollPaused] = useState(false)
  const rollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const currentRollStep = rollSteps[rollIdx]

  // Reset roll timer when step changes — render-phase reset
  const [prevRollIdx, setPrevRollIdx] = useState(rollIdx)
  const [rollAnchorMs, setRollAnchorMs] = useState(0)
  if (prevRollIdx !== rollIdx) {
    setPrevRollIdx(rollIdx)
    setRollSecondsLeft(currentRollStep?.area.sec ?? 0)
    setRollAnchorMs(Date.now())
  }

  // Tick roll timer — only while in 'roll' phase
  useEffect(() => {
    if (phase !== 'roll') return
    if (rollPaused || !currentRollStep) return
    if (rollAnchorMs === 0) setRollAnchorMs(Date.now())
    rollIntervalRef.current = setInterval(() => {
      setRollSecondsLeft((s) => {
        if (s <= 1) {
          if (rollIntervalRef.current) clearInterval(rollIntervalRef.current)
          setRollIdx((i) => (i >= rollSteps.length - 1 ? i : i + 1))
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => {
      if (rollIntervalRef.current) clearInterval(rollIntervalRef.current)
    }
  }, [phase, rollPaused, rollIdx, currentRollStep, rollSteps.length])

  const isLastRollStep = rollIdx >= rollSteps.length - 1
  const rollReachedTarget = rollSecondsLeft === 0 && isLastRollStep

  // ───── Handlers ─────

  function startHipBlock() {
    setPhase('hip')
    setHipIdx(0)
  }

  function advanceHip() {
    if (hipIntervalRef.current) clearInterval(hipIntervalRef.current)
    setHipRunning(false)
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

  function finishFoam() {
    if (rollIntervalRef.current) clearInterval(rollIntervalRef.current)
    logger.sessionEvent('recovery foam rolling complete', {
      recoveryId: recoverySession.id,
    })
    void persistBlockComplete(recoverySession.id, 'foamRolling')
    setPhase('done')
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
        : phase === 'roll-intro' || phase === 'roll'
          ? 1
          : 1,
    total: 2,
  }

  // Live Activity for recovery timers.
  const hipLiveConfig: LiveActivityConfig | null =
    phase === 'hip' && hipRunning && currentHipStep && hipStartedAtMs > 0
      ? {
          sessionType: 'recovery',
          sessionLabel: 'Recovery',
          state: {
            phase: 'hold',
            label: currentHipStep.movement.name,
            detail: currentHipStep.side
              ? currentHipStep.side === 'left' ? 'Left side' : 'Right side'
              : undefined,
            startedAt: hipStartedAtMs,
            endsAt: hipPaused
              ? Date.now() + hipSecondsLeft * 1000
              : hipStartedAtMs + (currentHipStep.movement.holdSec ?? 0) * 1000,
            isPaused: hipPaused,
            pausedRemaining: hipPaused ? hipSecondsLeft : undefined,
          },
        }
      : null

  const rollLiveConfig: LiveActivityConfig | null =
    phase === 'roll' && currentRollStep && rollAnchorMs > 0
      ? {
          sessionType: 'recovery',
          sessionLabel: 'Recovery',
          state: {
            phase: 'active',
            label: currentRollStep.area.name,
            detail: currentRollStep.side
              ? currentRollStep.side === 'left' ? 'Left side' : 'Right side'
              : undefined,
            startedAt: rollAnchorMs,
            endsAt: rollPaused
              ? Date.now() + rollSecondsLeft * 1000
              : rollAnchorMs + currentRollStep.area.sec * 1000,
            isPaused: rollPaused,
            pausedRemaining: rollPaused ? rollSecondsLeft : undefined,
          },
        }
      : null

  useSessionLiveActivity(hipLiveConfig ?? rollLiveConfig, {
    onPause: () => {
      if (phase === 'roll') setRollPaused(true)
      else if (phase === 'hip') setHipPaused(true)
    },
    onResume: (newEndsAtMs) => {
      if (phase === 'roll') {
        setRollPaused(false)
        if (newEndsAtMs) {
          const remaining = Math.max(0, Math.round((newEndsAtMs - Date.now()) / 1000))
          setRollSecondsLeft(remaining)
          setRollAnchorMs(Date.now())
        }
      } else if (phase === 'hip') {
        setHipPaused(false)
      }
    },
    onRestart: () => {
      if (phase === 'hip' && currentHipStep) {
        const holdSec = currentHipStep.movement.holdSec ?? 0
        setHipStartedAtMs(Date.now())
        setHipSecondsLeft(holdSec)
        setHipPaused(false)
      } else if (phase === 'roll' && currentRollStep) {
        setRollAnchorMs(Date.now())
        setRollSecondsLeft(currentRollStep.area.sec)
        setRollPaused(false)
      }
    },
    onEnd: () => {
      onExit?.()
    },
    // "Next →" / "Skip →" from the lock screen.
    // hip → advance to next hip step (or roll-intro);
    // roll → skip zone, or finish on last.
    onAdvance: () => {
      if (phase === 'hip') {
        advanceHip()
      } else if (phase === 'roll') {
        if (rollIntervalRef.current) clearInterval(rollIntervalRef.current)
        if (isLastRollStep) {
          finishFoam()
        } else {
          setRollIdx((i) => Math.min(i + 1, rollSteps.length - 1))
        }
      }
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
                    ? () => setHipPaused((p) => !p)
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
      if (!hipRunning && hipSecondsLeft === holdSec) {
        footer = (
          <Button
            onClick={() => setHipRunning(true)}
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
        onClick={() => setPhase('roll')}
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
              rollReachedTarget ? undefined : () => setRollPaused((p) => !p)
            }
          />
        </div>
      </div>
    )
    footer = (
      <div className="flex w-full gap-2">
        <Button
          onClick={() => setRollPaused((p) => !p)}
          size="lg"
          variant="secondary"
          className="flex-1"
        >
          {rollPaused ? 'Resume' : 'Pause'}
        </Button>
        <Button
          onClick={() => {
            if (rollIntervalRef.current) clearInterval(rollIntervalRef.current)
            if (isLastRollStep) {
              finishFoam()
            } else {
              setRollIdx((i) => Math.min(i + 1, rollSteps.length - 1))
            }
          }}
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
