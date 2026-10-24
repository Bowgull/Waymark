import { useEffect, useMemo, useState } from 'react'

import { FlapLabel } from '@/design'
import { FormVideoLink } from '@/components/FormVideoLink'
import { CountRow, GrassZone, HeroClock, PhaseWord, SessionButton, SessionFrame, TimerColumn, type TimerTrack } from '@/components/timers'
import { mediumHaptic } from '@/lib/haptics'
import { calculatePlates } from '@/lib/plateMath'
import { assessStrengthSet, shouldShowStrengthRealityMark } from '@/lib/trainingReality'
import { setLbsToKg, setNeedsWeight, startSetLbs, stepSetLbs } from '@/lib/timers/setWeight'

import type { StrengthSection, StrengthPhase } from './strengthMicrocopy'
import './session.css'

// ─── Section labels ────────────────────────────────────────────

const SECTION_LABELS: Record<StrengthSection, string> = {
  warmup: 'Warm Up',
  main: 'Main Lifts',
  accessory: 'Accessories',
  core: 'Core Circuit',
}

// ─── Display types ─────────────────────────────────────────────

export interface StrengthSetInput {
  /** UI-facing set number (1-based, warmups included). */
  setNumber: number
  /** Total sets for this exercise (warmups + working). */
  totalSets: number
  isWarmup: boolean
  suggestedWeightKg: number | null
  /** No planned load: this lift's last logged weight (this session, else last session). */
  carryWeightKg?: number | null
  /** He changed the last working set at this same planned load: start here (m12). */
  editedWeightKg?: number | null
  targetReps: number
  restSec: number
}

interface StrengthExerciseViewProps {
  phase: Extract<StrengthPhase, 'exercise' | 'rest'>
  /** The session on a flap (STRENGTH A). */
  sessionTitle?: string
  exerciseName: string
  formCues?: string | null
  equipment?: string | null
  notes?: string | null
  formVideoUrl?: string | null
  section: StrengthSection | null
  /** Current set input state. */
  currentSet?: StrengthSetInput
  lastSessionData?: { weightLbs: number; reps: number }
  suggestion?: { weightLbs: number; message: string }
  /** Rest timer state, required when phase === 'rest'. */
  restState?: {
    totalSeconds: number
    secondsRemaining: number
    isOvertime: boolean
    isPaused?: boolean
    /** Running: the rest's wall-clock end (the grass and the 5 s swell). */
    endsAtMs?: number
    onTogglePause?: () => void
    /** Page 85, swipe down: the rest again from its full time (every time; never back to the set, which stays saved). */
    onRestart?: () => void
  }
  onSetComplete: (weightKg: number | null, reps: number) => void
  onLiveValuesChange?: (weightKg: number | null, reps: number) => void
  onNextSet: () => void
  /** Hold the × (1.5 s): leave the session (kept in progress, resumable). */
  onExit?: () => void
}

/**
 * Strength: the set (page 31 "A set", page 19 "Logging a set · A, one tap as
 * planned") over the forest, and the rest between sets (page 19 "Strength
 * rest") on the grass. Swap Exercise is gone (design-decisions 2026-10-18).
 */
export function StrengthExerciseView({
  phase,
  sessionTitle = 'STRENGTH',
  exerciseName,
  formCues,
  equipment,
  notes,
  formVideoUrl,
  section,
  currentSet,
  lastSessionData,
  suggestion,
  restState,
  onSetComplete,
  onLiveValuesChange,
  onNextSet,
  onExit,
}: StrengthExerciseViewProps) {
  if (phase === 'rest' && restState) {
    const shown = Math.max(0, restState.secondsRemaining)
    const track: TimerTrack = {
      durationSec: restState.totalSeconds,
      endsAtMs: !restState.isPaused && restState.endsAtMs ? restState.endsAtMs : null,
      remainingMs: restState.secondsRemaining * 1000,
    }
    // Page 84: the lift small on top, REST / OVER, the clock 120 teal, NEXT / 3 / OF 4 under it
    // (out of the top bar). No NEXT SET button: a swipe up the grass moves on (Josh, 2026-10-23).
    const nextSet = currentSet && currentSet.setNumber < currentSet.totalSets ? currentSet.setNumber + 1 : null
    return (
      <SessionFrame
        title={sessionTitle}
        onEnd={onExit}
        paused={!!restState.isPaused}
        grass={<GrassZone track={track} kind="rest" state={restState.isPaused ? 'paused' : 'running'} onTap={restState.onTogglePause} onSkip={onNextSet} onBack={restState.onRestart} />}
      >
        <TimerColumn>
          <div className="tm-topx">
            <small>RESTING AFTER</small>
            <FlapLabel text={exerciseName} size="sm" fit />
          </div>
          <PhaseWord text={restState.isOvertime ? 'OVER' : 'REST'} tone="teal" />
          <HeroClock seconds={shown} kind="rest" tint="rest" track={track} px={120} />
          {nextSet != null && currentSet && <CountRow label="NEXT" n={nextSet} of={currentSet.totalSets} tone="teal" />}
        </TimerColumn>
      </SessionFrame>
    )
  }

  return (
    <SessionFrame title={sessionTitle} icon="strength" onEnd={onExit} forest>
      <div className="ss-scroll">
        {section && <span className="wm-label">{SECTION_LABELS[section]}</span>}
        <div className="wm-board">
          <div className="ss-row"><FlapLabel text={exerciseName} size="md" len={10} fit /></div>
          {notes && <p className="tm-note" style={{ marginTop: 8 }}>{notes}</p>}
        </div>
        {currentSet && (
          <SetBoard
            key={`${exerciseName}-${currentSet.setNumber}`}
            set={currentSet}
            equipment={equipment}
            lastSessionData={lastSessionData}
            suggestion={suggestion}
            onComplete={onSetComplete}
            onLiveValuesChange={onLiveValuesChange}
          />
        )}
        <FormLinks formCues={formCues && !sameText(formCues, notes) ? formCues : null} formVideoUrl={formVideoUrl} />
      </div>
    </SessionFrame>
  )
}

function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return norm(a) === norm(b)
}

function FormLinks({ formCues, formVideoUrl }: { formCues: string | null; formVideoUrl?: string | null }) {
  const [open, setOpen] = useState(false)
  if (!formCues && !formVideoUrl) return null
  return (
    <div className="ss-links">
      {formCues && (
        <>
          <button type="button" className="ss-linkbtn" onClick={() => setOpen(o => !o)}>{open ? 'Hide form cues' : 'Show form cues'}</button>
          {open && <p className="tm-note">{formCues}</p>}
        </>
      )}
      {formVideoUrl && <FormVideoLink url={formVideoUrl} compact />}
    </div>
  )
}

// ─── The set board ─────────────────────────────────────────────

/**
 * The set (page 31): "Set 1 of 3" with "Last: 135lb × 8", WEIGHT · LBS and REPS on
 * − / + steppers with the numbers on xl flaps, pre-filled from the plan, then one
 * LOG SET. Weights show in lb (plate-snapped, as the app loads them) and log as kg;
 * weight steps one loadable step (5 lb, page 19), reps 1.
 */
function SetBoard({
  set,
  equipment,
  lastSessionData,
  suggestion,
  onComplete,
  onLiveValuesChange,
}: {
  set: StrengthSetInput
  equipment?: string | null
  lastSessionData?: { weightLbs: number; reps: number }
  suggestion?: { weightLbs: number; message: string }
  onComplete: (weightKg: number | null, reps: number) => void
  onLiveValuesChange?: (weightKg: number | null, reps: number) => void
}) {
  const [weight, setWeight] = useState<number | null>(() => startSetLbs(set.suggestedWeightKg, equipment, set.carryWeightKg, set.editedWeightKg))
  const [reps, setReps] = useState(() => Math.max(0, set.targetReps))

  useEffect(() => {
    onLiveValuesChange?.(setLbsToKg(weight), reps)
  }, [weight, reps, onLiveValuesChange])

  const isBarbell = equipment?.toLowerCase().includes('barbell') ?? false
  const plates = useMemo(() => {
    if (!isBarbell || weight == null || weight <= 0) return null
    const r = calculatePlates(weight)
    if (r.plateCounts.length === 0) return 'Bar only'
    return r.plateCounts.map(p => `${p.count}× ${p.weight === Math.floor(p.weight) ? p.weight : p.weight.toFixed(1)}`).join('  ·  ')
  }, [weight, isBarbell])
  const noted = shouldShowStrengthRealityMark(assessStrengthSet({
    plannedWeightKg: set.suggestedWeightKg,
    plannedReps: set.targetReps,
    actualWeightKg: setLbsToKg(weight),
    actualReps: reps,
  }))

  // m11: a loadable working set (dumbbell, kettlebell, cable, machine) needs its weight; one he can do at bodyweight does not.
  const needsWeight = setNeedsWeight(equipment, set.isWarmup, weight)
  const blocked = reps <= 0 || needsWeight

  function log() {
    if (blocked) return
    mediumHaptic()
    onComplete(setLbsToKg(weight), reps)
  }

  const head = `${set.isWarmup ? 'Warmup' : 'Set'} ${set.setNumber} of ${set.totalSets}`
  return (
    <>
      <div className="wm-board">
        <div className="wm-board-head">
          <span>{head}</span>
          {lastSessionData && !set.isWarmup && <span className="ss-headnote">Last: {lastSessionData.weightLbs}lb × {lastSessionData.reps}</span>}
        </div>
        {weight != null && (
          <>
            <div className="wm-label" style={{ marginBottom: 6 }}>{/kettlebell/i.test(equipment ?? '') ? 'Weight · lbs per bell' : /dumbbell/i.test(equipment ?? '') ? 'Weight · lbs per dumbbell' : 'Weight · lbs'}</div>
            <div className="wm-stepper" role="group" aria-label="Weight in pounds">
              <button type="button" aria-label="Less weight" disabled={weight <= 0} onClick={() => setWeight(w => (w == null ? w : stepSetLbs(w, -1, equipment)))}>−</button>
              <span className="v" aria-live="polite"><FlapLabel text={String(weight)} size="xl" /></span>
              <button type="button" aria-label="More weight" onClick={() => setWeight(w => (w == null ? w : stepSetLbs(w, 1, equipment)))}>+</button>
            </div>
          </>
        )}
        <div className="wm-label" style={{ margin: weight != null ? '10px 0 6px' : '0 0 6px' }}>Reps</div>
        <div className="wm-stepper" role="group" aria-label="Reps">
          <button type="button" aria-label="Fewer reps" disabled={reps <= 0} onClick={() => setReps(r => Math.max(0, r - 1))}>−</button>
          <span className="v" aria-live="polite"><FlapLabel text={String(reps)} size="xl" /></span>
          <button type="button" aria-label="More reps" onClick={() => setReps(r => r + 1)}>+</button>
        </div>
        {(plates || (suggestion && !set.isWarmup) || noted || needsWeight) && (
          <div className="ss-extra">
            {needsWeight && <p className="tm-note">Set the weight you lift.</p>}
            {plates && <p className="tm-note">{plates}</p>}
            {suggestion && !set.isWarmup && weight !== suggestion.weightLbs && (
              <button type="button" className="ss-linkbtn is-left" onClick={() => setWeight(suggestion.weightLbs)}>Try {suggestion.weightLbs}lb?</button>
            )}
            {noted && <p className="tm-note">Noted.</p>}
          </div>
        )}
      </div>
      <SessionButton label="LOG SET" primary onClick={log} disabled={blocked} />
    </>
  )
}
