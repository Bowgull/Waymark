import { useState } from 'react'

import { RingTimer } from '@/components/RingTimer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { GoldDivider } from '@/components/ui/GoldDivider'

import { SessionShell } from './SessionShell'
import { SetTracker } from './SetTracker'
import {
  resolveStrengthMoment,
  type StrengthSection,
  type StrengthPhase,
} from './strengthMicrocopy'

// ─── Section labels ────────────────────────────────────────────

const SECTION_LABELS: Record<StrengthSection, string> = {
  warmup: 'Warm Up',
  main: 'Main Lifts',
  accessory: 'Accessories',
  core: 'Core Circuit',
}

// ─── Display types ─────────────────────────────────────────────

export interface StrengthPrescriptionDisplay {
  weightLbs: number | null
  tmLbs: number | null
  setsReps: string
  plateMath: string | null
  wavePercentage: number | null
}

export interface StrengthHistoryDisplay {
  lastWeightLbs: number | null
  lastReps: number | null
  lastDate: string | null
  prWeightLbs: number | null
  prReps: number | null
  prDate: string | null
  recentTrend: { date: string; weightLbs: number; avgReps: number }[] | null
  suggestion: { message: string } | null
}

export interface StrengthSetInput {
  /** UI-facing set number (1-based, warmups included). */
  setNumber: number
  /** Total sets for this exercise (warmups + working). */
  totalSets: number
  isWarmup: boolean
  suggestedWeightKg: number | null
  targetReps: number
  restSec: number
}

interface StrengthExerciseViewProps {
  phase: Extract<StrengthPhase, 'exercise' | 'rest'>
  exerciseIndex: number
  totalExercises: number
  exerciseName: string
  exerciseId?: string
  formCues?: string | null
  equipment?: string | null
  notes?: string | null
  formVideoUrl?: string | null
  section: StrengthSection | null
  showSectionHeader: boolean
  /** Current set input state. Present in both phases; used to compute flags. */
  currentSet?: StrengthSetInput
  /** Index of the current set within the exercise (0-based). */
  setIdx: number
  /** Is this the final set of the whole session. */
  isLastSetOfSession: boolean
  prescription?: StrengthPrescriptionDisplay
  history?: StrengthHistoryDisplay
  lastSessionData?: { weightLbs: number; reps: number }
  suggestion?: { weightLbs: number; message: string }
  /** Rest timer state — required when phase === 'rest'. */
  restState?: {
    totalSeconds: number
    secondsRemaining: number
    isOvertime: boolean
  }
  onSetComplete: (weightKg: number | null, reps: number) => void
  onNextSet: () => void
  onSkip?: () => void
  onExit?: () => void
  /** Ring accent (defaults to gold). */
  accentColor?: string
}

// ─── View ───────────────────────────────────────────────────────

export function StrengthExerciseView({
  phase,
  exerciseIndex,
  totalExercises,
  exerciseName,
  exerciseId,
  formCues,
  equipment,
  notes,
  formVideoUrl,
  section,
  showSectionHeader,
  currentSet,
  setIdx,
  isLastSetOfSession,
  prescription,
  history,
  lastSessionData,
  suggestion,
  restState,
  onSetComplete,
  onNextSet,
  onSkip,
  onExit,
  accentColor = '#E8C860',
}: StrengthExerciseViewProps) {
  // Moment line — context differs per phase.
  // Section intro only fires on the first set of the first exercise in the
  // section. Later sets fall through to the per-lift line.
  const moment = resolveStrengthMoment({
    phase,
    exerciseId,
    exerciseName,
    section: section ?? undefined,
    isFirstInSection: showSectionHeader && section != null && setIdx === 0,
    isFirstOverall: exerciseIndex === 0 && setIdx === 0,
    isLastSet: isLastSetOfSession,
    restSecondsRemaining: restState?.secondsRemaining,
  })

  // Progress: total = sum of sets across the whole session is not known here,
  // so approximate with exerciseIndex dots. The caller could pass richer progress
  // later if we want per-set granularity.
  const progress = {
    completed: exerciseIndex,
    active: exerciseIndex,
    total: totalExercises,
  }

  const counter = `${exerciseIndex + 1} of ${totalExercises}`

  // ─── Body renderers ──────────────────────────────────────────

  const body =
    phase === 'rest' && restState ? (
      <RestBody
        exerciseName={exerciseName}
        totalSeconds={restState.totalSeconds}
        secondsRemaining={restState.secondsRemaining}
        isOvertime={restState.isOvertime}
        accentColor={accentColor}
      />
    ) : (
      <ExerciseBody
        exerciseName={exerciseName}
        equipment={equipment}
        notes={notes}
        formCues={formCues}
        formVideoUrl={formVideoUrl}
        section={section}
        showSectionHeader={showSectionHeader}
        prescription={prescription}
        history={history}
        currentSet={currentSet}
        lastSessionData={lastSessionData}
        suggestion={suggestion}
        onSetComplete={onSetComplete}
      />
    )

  // ─── Footer ──────────────────────────────────────────────────

  const footer =
    phase === 'rest' ? (
      <Button
        onClick={onNextSet}
        size="lg"
        className="w-full"
        style={{ backgroundColor: accentColor, color: '#020A08' }}
      >
        Next Set
      </Button>
    ) : onSkip ? (
      <button
        onClick={onSkip}
        className="min-h-[44px] w-full text-center text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground/70 active:text-muted-foreground"
      >
        Skip Exercise
      </button>
    ) : undefined

  return (
    <SessionShell
      sessionType="strength"
      counter={phase === 'rest' ? 'Rest' : counter}
      progress={progress}
      moment={moment}
      onExit={onExit}
      footer={footer}
    >
      {body}
    </SessionShell>
  )
}

// ─── Rest body ─────────────────────────────────────────────────

interface RestBodyProps {
  exerciseName: string
  totalSeconds: number
  secondsRemaining: number
  isOvertime: boolean
  accentColor: string
}

function RestBody({
  exerciseName,
  totalSeconds,
  secondsRemaining,
  isOvertime,
  accentColor,
}: RestBodyProps) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center pt-6 animate-fade-in">
      <p className="font-cinzel text-[11px] uppercase tracking-[0.28em] text-gold/50">
        Resting after
      </p>
      <h2 className="mt-1 text-display-lg text-foreground">{exerciseName}</h2>

      <div className="mt-8 rounded-2xl border border-gold/15 bg-deep-forest/60 p-5 shadow-[inset_0_1px_0_rgba(232,200,96,0.06)]">
        <RingTimer
          totalSeconds={totalSeconds}
          secondsRemaining={secondsRemaining}
          isOvertime={isOvertime}
          label={isOvertime ? 'Over' : 'Rest'}
          accentColor={accentColor}
        />
      </div>
    </div>
  )
}

// ─── Exercise body ─────────────────────────────────────────────

interface ExerciseBodyProps {
  exerciseName: string
  equipment?: string | null
  notes?: string | null
  formCues?: string | null
  formVideoUrl?: string | null
  section: StrengthSection | null
  showSectionHeader: boolean
  prescription?: StrengthPrescriptionDisplay
  history?: StrengthHistoryDisplay
  currentSet?: StrengthSetInput
  lastSessionData?: { weightLbs: number; reps: number }
  suggestion?: { weightLbs: number; message: string }
  onSetComplete: (weightKg: number | null, reps: number) => void
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function textsEffectivelyMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return norm(a) === norm(b)
}

function ExerciseBody({
  exerciseName,
  equipment,
  notes,
  formCues,
  formVideoUrl,
  section,
  showSectionHeader,
  prescription,
  history,
  currentSet,
  lastSessionData,
  suggestion,
  onSetComplete,
}: ExerciseBodyProps) {
  const [breakdownOpen, setBreakdownOpen] = useState(false)

  // Section intro shown in-body only if the shell already gave us a moment —
  // we still want the formal section label with divider for hierarchy.
  const sectionLabel = section ? SECTION_LABELS[section] : null

  // Collapse duplicate breakdown: if formCues restates notes, hide it.
  const breakdown =
    formCues && !textsEffectivelyMatch(formCues, notes) ? formCues : null

  // Only show the prescription card when we actually have prescribed data.
  const hasPrescription =
    (section === 'main' && prescription?.weightLbs) ||
    ((section === 'accessory' || section === 'core') && history)

  return (
    <div className="mx-auto max-w-md animate-fade-in">
      {showSectionHeader && sectionLabel && (
        <div className="mb-5">
          <h3
            className={`font-cinzel text-xs font-semibold uppercase tracking-[0.3em] ${
              section === 'core' ? 'text-gold' : 'text-gold/70'
            }`}
          >
            {sectionLabel}
          </h3>
          {section === 'core' && (
            <p className="mt-1 text-xs text-muted-foreground">
              15-18 min dedicated block.
            </p>
          )}
          <GoldDivider className="mt-2" />
        </div>
      )}

      <h2 className="text-display-lg leading-[1.1] text-foreground">
        {exerciseName}
      </h2>

      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        {equipment && <Badge variant="muted">{equipment}</Badge>}
      </div>

      {notes && (
        <p className="mt-3 text-sm leading-relaxed text-foreground/85">
          {notes}
        </p>
      )}

      {/* Prescription / History card */}
      {hasPrescription && (
        <div className="mt-4 rounded border border-gold/15 bg-gradient-to-b from-[#1A1A10]/60 to-[#12170E]/40 p-5 shadow-[0_0_12px_rgba(0,0,0,0.3)]">
          {section === 'main' && prescription?.weightLbs && (
            <div>
              <p className="mb-1 font-cinzel text-[13px] uppercase tracking-widest text-gold/40">
                Prescribed
              </p>
              <p className="font-cinzel text-lg font-semibold text-gold">
                {prescription.setsReps} @ {prescription.weightLbs}lb
              </p>
              {prescription.plateMath && (
                <p className="text-xs text-muted-foreground">
                  {prescription.plateMath}
                </p>
              )}
              {prescription.wavePercentage && prescription.tmLbs && (
                <p className="text-xs text-muted-foreground">
                  {Math.round(prescription.wavePercentage * 100)}% of TM (
                  {prescription.tmLbs}lb)
                </p>
              )}
              {history?.prWeightLbs && history.prDate && (
                <p className="mt-1 text-xs text-gold/60">
                  PR: {history.prWeightLbs}lb × {history.prReps} (
                  {formatShortDate(history.prDate)})
                </p>
              )}
            </div>
          )}

          {section === 'accessory' && history && (
            <div>
              <p className="mb-1 font-cinzel text-[13px] uppercase tracking-widest text-gold/40">
                Last Session
              </p>
              {history.lastWeightLbs && history.lastDate && (
                <p className="text-xs text-muted-foreground">
                  {history.lastWeightLbs}lb × {history.lastReps} (
                  {formatShortDate(history.lastDate)})
                </p>
              )}
              {history.recentTrend && history.recentTrend.length > 1 && (
                <p className="text-xs text-muted-foreground">
                  {history.recentTrend.map(t => `${t.weightLbs}lb`).join(' \u2192 ')}
                </p>
              )}
              {history.suggestion && (
                <p className="mt-1.5 inline-block rounded-full border border-gold/30 bg-gold/10 px-2.5 py-0.5 text-xs font-medium text-gold">
                  {history.suggestion.message}
                </p>
              )}
            </div>
          )}

          {section === 'core' && history && (
            <div>
              <p className="mb-1 font-cinzel text-[13px] uppercase tracking-widest text-gold/40">
                Last Session
              </p>
              {history.lastWeightLbs != null && history.lastDate && (
                <p className="text-xs text-muted-foreground">
                  {history.lastReps} reps ({formatShortDate(history.lastDate)})
                </p>
              )}
              {history.suggestion && (
                <p className="mt-1.5 inline-block rounded-full border border-gold/30 bg-gold/10 px-2.5 py-0.5 text-xs font-medium text-gold">
                  {history.suggestion.message}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Set tracker — stays inline because the Done button sits next to the inputs. */}
      {currentSet && (
        <SetTracker
          setNumber={currentSet.setNumber}
          totalSets={currentSet.totalSets}
          isWarmup={currentSet.isWarmup}
          suggestedWeightKg={currentSet.suggestedWeightKg}
          targetReps={currentSet.targetReps}
          lastSessionData={lastSessionData}
          suggestion={suggestion}
          onComplete={onSetComplete}
        />
      )}

      {/* Form breakdown + video toggle */}
      {(breakdown || formVideoUrl) && (
        <div className="mt-6 rounded border border-gold/15 bg-gradient-to-b from-[#1C1A12]/70 to-[#14120C]/50 p-4 shadow-inner">
          {breakdown && (
            <div>
              <button
                type="button"
                onClick={() => setBreakdownOpen(o => !o)}
                className="flex items-center gap-1.5 font-cinzel text-xs font-medium tracking-wider text-teal active:text-teal/70"
              >
                <span>
                  {breakdownOpen ? 'Hide form cues' : 'Show form cues'}
                </span>
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
                <p className="mt-2 font-cinzel text-xs leading-relaxed text-teal/80">
                  {breakdown}
                </p>
              )}
            </div>
          )}

          {formVideoUrl && (
            <a
              href={formVideoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center gap-1.5 font-cinzel text-xs font-medium tracking-wider text-teal active:text-teal/70 ${breakdown ? 'mt-2' : ''}`}
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              Watch Form
            </a>
          )}
        </div>
      )}
    </div>
  )
}
