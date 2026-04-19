import { useEffect, useState } from 'react'

import { FormVideoLink } from '@/components/FormVideoLink'
import { RingTimer } from '@/components/RingTimer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { GoldDivider } from '@/components/ui/GoldDivider'
import {
  MOBILITY_SECTION_LABELS,
  type MobilitySection,
} from '@/lib/mobilityTemplate'

import { SessionShell } from './SessionShell'
import { resolveMobilityMoment } from './mobilityMicrocopy'
import { useHoldTimer, type HoldTimerState, type HoldTimerActions } from './useHoldTimer'
import { useSessionLiveActivity, type LiveActivityConfig } from './useSessionLiveActivity'

interface MobilityExercise {
  id: string
  exerciseId: string
  orderIndex: number
  holdSec: number | null
  sets: number | null
  reps?: number | null
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

// Loose duplicate check: whitespace-/punctuation-collapsed, lowercased comparison.
function textsEffectivelyMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return norm(a) === norm(b)
}

interface SharedBodyProps {
  exercise: MobilityExercise
  currentSet: number
  showSectionHeader: boolean
  holdTimer: HoldTimerState & HoldTimerActions
  isHoldExercise: boolean
}

interface MobilityExerciseBodyProps extends Omit<SharedBodyProps, 'holdTimer' | 'isHoldExercise'> {
  onSetDone: () => void
}

interface MobilityExerciseViewProps extends MobilityExerciseBodyProps {
  exerciseIndex: number
  totalExercises: number
  /** Back button handler. Defaults to /today via SessionShell. */
  onExit?: () => void
  /** Skip handler — opens SkipReasonSheet. Omit to hide the skip action. */
  onSkip?: () => void
  /**
   * When true, render body + inline footer only (no SessionShell wrapper).
   * Used by Foundation Run which provides its own outer frame.
   */
  inline?: boolean
}

// ─────────────────────────────────────────────────────────────
// Body (frame-less) — used when another engine nests mobility
// exercises inside its own SessionShell (e.g. Foundation Run).
// ─────────────────────────────────────────────────────────────

export function MobilityExerciseBody({
  exercise,
  currentSet,
  showSectionHeader,
  holdTimer,
  isHoldExercise,
}: SharedBodyProps) {
  const [breakdownOpen, setBreakdownOpen] = useState(false)
  const totalSets = exercise.sets ?? 1
  const totalReps = exercise.reps ?? null
  const sectionLabel = exercise.section
    ? MOBILITY_SECTION_LABELS[exercise.section as MobilitySection]
    : null

  // Collapse duplicate breakdown: if formCues says the same thing as notes, drop it.
  const breakdown =
    exercise.exercise?.formCues && !textsEffectivelyMatch(exercise.exercise.formCues, exercise.notes)
      ? exercise.exercise.formCues
      : null

  return (
    <div className="mx-auto max-w-md animate-fade-in">
      {showSectionHeader && sectionLabel && (
        <div className="mb-5">
          <h3 className="font-cinzel text-xs font-semibold uppercase tracking-[0.3em] text-gold/70">
            {sectionLabel}
          </h3>
          <GoldDivider className="mt-2" />
        </div>
      )}

      <h2 className="text-display-lg leading-[1.1] text-foreground">
        {exercise.exercise?.name ?? 'Exercise'}
      </h2>

      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        {exercise.exercise?.equipment && (
          <Badge variant="muted">{exercise.exercise.equipment}</Badge>
        )}
        {totalSets > 1 && (
          <span className="font-cinzel uppercase tracking-[0.18em] text-gold/50">
            Set {currentSet} of {totalSets}
          </span>
        )}
      </div>

      {exercise.notes && (
        <p className="mt-4 text-sm leading-relaxed text-foreground/85">
          {exercise.notes}
        </p>
      )}

      {breakdown && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setBreakdownOpen(o => !o)}
            className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.18em] text-gold/60 active:text-gold"
          >
            <span>{breakdownOpen ? 'Hide breakdown' : 'Show breakdown'}</span>
            <svg
              className={`h-3 w-3 transition-transform ${breakdownOpen ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {breakdownOpen && (
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {breakdown}
            </p>
          )}
        </div>
      )}

      {exercise.exercise?.formVideoUrl && (
        <div className="mt-4">
          <FormVideoLink url={exercise.exercise.formVideoUrl} compact />
        </div>
      )}

      {/* Ring or rep card */}
      <div className="mt-8 flex justify-center">
        {isHoldExercise && exercise.holdSec ? (
          <div className="rounded-2xl border border-teal/20 bg-deep-forest/60 p-5 shadow-[inset_0_1px_0_rgba(74,202,170,0.08)]">
            <RingTimer
              totalSeconds={exercise.holdSec}
              secondsRemaining={
                holdTimer.running ? holdTimer.secondsRemaining : exercise.holdSec
              }
              label={
                holdTimer.reachedTarget
                  ? 'Hold Complete'
                  : holdTimer.running
                    ? 'Hold'
                    : 'Ready'
              }
              accentColor="#4ACAAA"
              isComplete={holdTimer.reachedTarget}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-gold/15 bg-deep-forest/50 px-10 py-8 shadow-[inset_0_1px_0_rgba(232,200,96,0.06)]">
            <p className="font-cinzel text-xs uppercase tracking-[0.28em] text-gold/60">
              {totalReps ? 'Reps' : 'Set'}
            </p>
            <p
              className="text-timer text-foreground"
              style={{ fontSize: '3.5rem' }}
            >
              {totalReps ?? (totalSets > 1 ? `${currentSet}/${totalSets}` : '\u2014')}
            </p>
            <p className="text-xs text-muted-foreground">
              {totalReps
                ? totalSets > 1
                  ? `Set ${currentSet} of ${totalSets}. Tap done when finished.`
                  : 'Tap done when finished.'
                : 'Tap done when the set is complete.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Full engine view — wraps body + footer in SessionShell.
// Used as the full-page render for the mobility engine.
// ─────────────────────────────────────────────────────────────

export function MobilityExerciseView({
  exercise,
  exerciseIndex,
  totalExercises,
  currentSet,
  showSectionHeader,
  onSetDone,
  onExit,
  onSkip,
  inline = false,
}: MobilityExerciseViewProps) {
  const totalSets = exercise.sets ?? 1
  const isHoldExercise = exercise.holdSec != null && exercise.holdSec > 0
  const holdTimer = useHoldTimer(exercise.holdSec ?? 0)

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

  const moment = resolveMobilityMoment({
    exerciseId: exercise.exerciseId,
    phase: 'exercise',
    isFirst: exerciseIndex === 0,
    isLast: exerciseIndex === totalExercises - 1,
    isHold: isHoldExercise,
    holdSecRemaining: holdTimer.running ? holdTimer.secondsRemaining : undefined,
  })

  // Live Activity for mobility holds — no pause (holds are brief + manual).
  const mobilityActivityConfig: LiveActivityConfig | null =
    !inline && isHoldExercise && holdTimer.running && !holdTimer.reachedTarget
      ? {
          sessionType: 'mobility',
          sessionLabel: 'Mobility',
          state: {
            phase: 'hold',
            label: exercise.exercise?.name ?? 'Hold',
            detail:
              (exercise.sets ?? 1) > 1
                ? `Set ${currentSet} of ${exercise.sets}`
                : undefined,
            startedAt: holdTimer.startedAtMs,
            endsAt: holdTimer.endsAtMs,
            isPaused: false,
          },
        }
      : null

  useSessionLiveActivity(mobilityActivityConfig)

  const footerAction = (() => {
    if (isHoldExercise) {
      if (!holdTimer.running) {
        return (
          <Button
            onClick={holdTimer.start}
            size="lg"
            className="w-full"
            style={{
              background: 'linear-gradient(180deg, #4ACAAA 0%, #1E8A68 100%)',
              color: '#020A08',
            }}
          >
            Start Hold
          </Button>
        )
      }
      return (
        <Button
          onClick={() => {
            holdTimer.stop()
            onSetDone()
          }}
          size="lg"
          className="w-full"
          variant={holdTimer.reachedTarget ? 'default' : 'secondary'}
        >
          {holdTimer.reachedTarget ? 'Done' : 'End Early'}
        </Button>
      )
    }
    return (
      <Button onClick={onSetDone} size="lg" className="w-full">
        Done
      </Button>
    )
  })()

  const footer = (
    <div className="flex flex-col gap-2">
      {footerAction}
      {onSkip && (
        <button
          onClick={onSkip}
          className="min-h-[44px] text-center text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground/70 active:text-muted-foreground"
        >
          Skip Exercise
        </button>
      )}
    </div>
  )

  // Progress across all sets in the session
  const completedSteps = exerciseIndex * totalSets + Math.max(0, currentSet - 1)
  const activeStep = exerciseIndex * totalSets + (currentSet - 1)
  const totalSteps = totalExercises * totalSets

  // Inline mode: body + action only, no SessionShell. Foundation Run uses this
  // so it can nest mobility exercises inside its own outer frame.
  if (inline) {
    return (
      <div className="flex flex-col gap-4">
        <MobilityExerciseBody
          exercise={exercise}
          currentSet={currentSet}
          showSectionHeader={showSectionHeader}
          holdTimer={holdTimer}
          isHoldExercise={isHoldExercise}
        />
        <div className="mx-auto w-full max-w-md">{footerAction}</div>
      </div>
    )
  }

  return (
    <SessionShell
      sessionType="mobility"
      title="Mobility"
      counter={`${exerciseIndex + 1} of ${totalExercises}`}
      progress={{
        completed: completedSteps,
        active: activeStep,
        total: totalSteps,
      }}
      moment={moment}
      onExit={onExit}
      footer={footer}
    >
      <MobilityExerciseBody
        exercise={exercise}
        currentSet={currentSet}
        showSectionHeader={showSectionHeader}
        holdTimer={holdTimer}
        isHoldExercise={isHoldExercise}
      />
    </SessionShell>
  )
}
