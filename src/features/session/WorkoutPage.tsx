import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { apiFetch } from '@/lib/api'
import { getMarkAsset, getSessionAccent } from '@/lib/markAssets'
import { getSessionLabel } from '@/lib/weeklyTemplate'
import { kgToLbs } from '@/lib/units'
import { calculatePlates } from '@/lib/plateMath'
import { scheduleStrengthRestEnd, cancelStrengthRestEnd } from '@/lib/notifications'
import { SessionBackground } from '@/components/backgrounds/SessionBackground'
import { Button } from '@/components/ui/button'
import { GoldDivider } from '@/components/ui/GoldDivider'

import { ActiveRecoveryView } from './ActiveRecoveryView'
import { BagWorkRoundView } from './BagWorkRoundView'
import { ComboRatingScreen } from './ComboRatingScreen'
import { ComboUnlockSuggestion } from './ComboUnlockSuggestion'
import { ExerciseView } from './ExerciseView'
import { MarkEarnedOverlay } from './MarkEarnedOverlay'
import { MtClassLogView } from './MtClassLogView'
import { PostureExerciseView } from './PostureExerciseView'
import { RestTimer } from './RestTimer'
import { RitualEntrance } from './RitualEntrance'
import { RunSessionView } from './RunSessionView'
import { SessionComplete } from './SessionComplete'
import { SkipRopeView } from './SkipRopeView'
import { SetTracker } from './SetTracker'
import { useRestTimer } from './useRestTimer'

// ─── Shared types ──────────────────────────────────────────────

interface SessionData {
  id: string
  type: string
  status: string
  blockWeek?: number | null
  scheduledDate?: number | null
}

// ─── Strength types ────────────────────────────────────────────

interface SetData {
  id: string
  setNumber: number
  weightKg: number | null
  reps: number
  isWarmup: number
  restSec: number | null
}

interface PrescriptionData {
  trainingMaxKg: number | null
  wavePercentage: number | null
  prescribedWeightKg: number | null
  setsReps: string
}

interface ExerciseHistoryData {
  lastSession: { weightKg: number; reps: number; date: string; allSets: { weightKg: number; reps: number }[] } | null
  pr: { weightKg: number; reps: number; date: string } | null
  recentTrend: { date: string; maxWeightKg: number; avgReps: number }[]
  suggestion: { type: string; message: string; suggestedWeightKg: number | null } | null
}

interface StrengthExerciseData {
  id: string
  exerciseId: string
  orderIndex: number
  section: string | null
  notes: string | null
  exercise: { name: string; formCues: string | null; equipment: string | null; formVideoUrl?: string | null } | null
  sets: SetData[]
  prescription?: PrescriptionData
}

interface StrengthWorkoutData {
  session: SessionData
  exercises: StrengthExerciseData[]
}

// ─── Posture types ─────────────────────────────────────────────

interface PostureExerciseData {
  id: string
  exerciseId: string
  orderIndex: number
  holdSec: number | null
  sets: number | null
  completed: number
  section?: string | null
  exercise: { name: string; formCues: string | null; equipment: string | null; formVideoUrl?: string | null } | null
  notes: string | null
}

interface PostureWorkoutData {
  session: SessionData
  exercises: PostureExerciseData[]
}

// ─── Bag work types ────────────────────────────────────────────

interface BagComboData {
  id: string
  orderIndex: number
  combo: { id: string; text: string; tier: string; level: string; masteryScore?: number; isFavourite?: number; techniques?: string } | null
}

interface UnlockSuggestion {
  id: string
  text: string
  tier: string
  techniques: string
}

interface BagRoundData {
  id: string
  roundNumber: number
  durationSec: number
  restSec: number
  combos: BagComboData[]
}

interface BagWorkoutData {
  session: SessionData
  rounds: BagRoundData[]
}

// ─── Run types ─────────────────────────────────────────────────

interface RunSessionData {
  id: string
  runType: string | null
  distanceKm: number | null
  durationSec: number | null
  isIndoor: number
  onePaceArc: string | null
  onePaceEp: string | null
}

interface RunPrescription {
  weekNumber: number
  runType: string
  targetDesc: string
  targetDurSec: number | null
  targetDistKm: number | null
}

interface RunWorkoutData {
  session: SessionData
  runSession: RunSessionData | null
  prescription?: RunPrescription | null
}

interface FoundationRunWorkoutData {
  session: SessionData
  runSession: RunSessionData | null
  prescription?: RunPrescription | null
  postureExercises: PostureExerciseData[]
}

// ─── Skip rope types ───────────────────────────────────────────

interface SkipSessionData {
  id: string
  roundCount: number
  roundDurSec: number
}

interface SkipWorkoutData {
  session: SessionData
  skipSession: SkipSessionData | null
}

// ─── Active recovery types ─────────────────────────────────────

interface RecoverySessionData {
  id: string
  hipMobility: number
  foamRolling: number
}

interface RecoveryWorkoutData {
  session: SessionData
  recoverySession: RecoverySessionData | null
}

// ─── MT class types ────────────────────────────────────────────

interface MtLogData {
  id: string
  classType: string | null
  focusSkill: string | null
  weakness: string | null
  concept: string | null
  actionItems: string | null
}

interface MtClassWorkoutData {
  session: SessionData
  mtLog: MtLogData | null
}

// ─── Section labels ────────────────────────────────────────────

const SECTION_LABELS: Record<string, string> = {
  warmup: 'WARM UP',
  main: 'MAIN LIFTS',
  accessory: 'ACCESSORIES',
  core: 'CORE CIRCUIT',
}

// ─── Phases ────────────────────────────────────────────────────

type Phase = 'entrance' | 'exercise' | 'rest' | 'breathe' | 'mark-earned' | 'complete' | 'bag-preview' | 'combo-rating' | 'combo-unlock' | 'fr-run' | 'fr-transition' | 'fr-posture'
type RoundPhase = 'ready' | 'fighting' | 'rest'

function FrTransition({ onComplete }: { onComplete: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onComplete, 5000)
    return () => clearTimeout(timer)
  }, [onComplete])

  return (
    <div className="flex flex-col items-center justify-center py-16 animate-fade-in">
      <p className="text-display text-gold mb-2">Run Complete</p>
      <p className="text-sm text-muted-foreground mb-8">Shifting to Foundation work...</p>
      <div className="h-1 w-48 rounded bg-surface overflow-hidden">
        <div className="h-full bg-teal animate-pulse" style={{ width: '100%' }} />
      </div>
    </div>
  )
}

export function WorkoutPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [sessionType, setSessionType] = useState<string | null>(null)
  const [sessionStatus, setSessionStatus] = useState<string | null>(null)
  const [sessionDayOfWeek, setSessionDayOfWeek] = useState<number | undefined>(undefined)
  const [strengthData, setStrengthData] = useState<StrengthWorkoutData | null>(null)
  const [postureData, setPostureData] = useState<PostureWorkoutData | null>(null)
  const [bagData, setBagData] = useState<BagWorkoutData | null>(null)
  const [runData, setRunData] = useState<RunWorkoutData | null>(null)
  const [skipData, setSkipData] = useState<SkipWorkoutData | null>(null)
  const [recoveryData, setRecoveryData] = useState<RecoveryWorkoutData | null>(null)
  const [mtData, setMtData] = useState<MtClassWorkoutData | null>(null)
  const [foundationRunData, setFoundationRunData] = useState<FoundationRunWorkoutData | null>(null)
  const [exerciseHistories, setExerciseHistories] = useState<Map<string, ExerciseHistoryData>>(new Map())
  const [loading, setLoading] = useState(true)
  const [exerciseIdx, setExerciseIdx] = useState(0)
  const [setIdx, setSetIdx] = useState(0)
  const [roundIdx, setRoundIdx] = useState(0)
  const [roundPhase, setRoundPhase] = useState<RoundPhase>('ready')
  const [phase, setPhase] = useState<Phase>('entrance')
  const [submitting, setSubmitting] = useState(false)
  const [unlockSuggestions, setUnlockSuggestions] = useState<{ suggestions: UnlockSuggestion[]; message: string } | null>(null)

  const restTimer = useRestTimer()

  useEffect(() => {
    if (!id) return
    async function load() {
      try {
        const allSessions = await apiFetch<SessionData[]>('/api/sessions')
        const session = allSessions.find(s => s.id === id)
        if (!session) throw new Error('Session not found')

        setSessionType(session.type)
        setSessionStatus(session.status)
        if (session.scheduledDate != null) {
          setSessionDayOfWeek(new Date(session.scheduledDate * 86400000).getUTCDay())
        }

        // Skip entrance for in-progress sessions (returning to continue)
        if (session.status === 'in_progress') {
          setPhase(session.type === 'foundation_run' ? 'fr-run' : 'exercise')
        }

        if (session.type === 'foundation_run') {
          const data = await apiFetch<FoundationRunWorkoutData>(`/api/sessions/${id}/foundation-run-workout`)
          setFoundationRunData(data)
        } else if (session.type === 'posture_corrective') {
          const data = await apiFetch<PostureWorkoutData>(`/api/sessions/${id}/posture-workout`)
          setPostureData(data)
        } else if (session.type === 'bag_work') {
          const data = await apiFetch<BagWorkoutData>(`/api/sessions/${id}/bag-workout`)
          setBagData(data)
        } else if (session.type === 'running') {
          const data = await apiFetch<RunWorkoutData>(`/api/sessions/${id}/run-workout`)
          setRunData(data)
        } else if (session.type === 'skip_rope') {
          const data = await apiFetch<SkipWorkoutData>(`/api/sessions/${id}/skip-rope-workout`)
          setSkipData(data)
        } else if (session.type === 'active_recovery') {
          const data = await apiFetch<RecoveryWorkoutData>(`/api/sessions/${id}/recovery-workout`)
          setRecoveryData(data)
        } else if (session.type === 'mt_class') {
          const data = await apiFetch<MtClassWorkoutData>(`/api/sessions/${id}/mt-class-workout`)
          setMtData(data)
        } else {
          const data = await apiFetch<StrengthWorkoutData>(`/api/sessions/${id}/workout`)
          setStrengthData(data)

          // Fetch exercise histories for weight prescription context
          const uniqueExercises = new Map(data.exercises.map(e => [e.exerciseId, e.section ?? 'main']))
          const histories = new Map<string, ExerciseHistoryData>()
          await Promise.all(
            Array.from(uniqueExercises).map(async ([exId, section]) => {
              try {
                const h = await apiFetch<ExerciseHistoryData>(`/api/exercises/${exId}/history?section=${section}`)
                if (h) histories.set(exId, h)
              } catch { /* no history yet */ }
            })
          )
          setExerciseHistories(histories)
        }
      } catch (e) {
        console.error('Failed to load workout:', e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  const handleEntranceComplete = useCallback(() => {
    // Show preview for bag work before starting rounds
    if (sessionType === 'bag_work') {
      setPhase('bag-preview')
    } else {
      setPhase('exercise')
    }
  }, [sessionType])

  const handleMarkEarnedComplete = useCallback(() => {
    setPhase('complete')
  }, [])

  async function handleFinish(rpe: number, difficulty: number, notes: string) {
    if (!id) return
    setSubmitting(true)
    try {
      await apiFetch(`/api/sessions/${id}/complete`, {
        method: 'POST',
        body: JSON.stringify({ rpe, difficulty, notes }),
      })
      navigate('/today', { replace: true })
    } catch (e) {
      console.error('Failed to complete session:', e)
      setSubmitting(false)
    }
  }

  // ─── Loading ──────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-near-black">
        <p className="text-sm text-muted-foreground">Loading workout...</p>
      </div>
    )
  }

  // ─── Entrance animation ───────────────────────────────────

  if (phase === 'entrance' && sessionType) {
    return (
      <RitualEntrance
        sessionType={sessionType}
        onComplete={handleEntranceComplete}
      />
    )
  }

  // ─── Mark earned overlay ──────────────────────────────────

  if (phase === 'mark-earned' && sessionType) {
    return (
      <MarkEarnedOverlay
        sessionType={sessionType}
        onComplete={handleMarkEarnedComplete}
      />
    )
  }

  // ─── Breathing cue interstitial (Foundation) ──────────────

  if (phase === 'breathe') {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center bg-near-black">
        <SessionBackground />
        <p className="relative z-10 animate-fade-in font-cinzel text-2xl tracking-widest text-gold/60 animate-pulse-glow">
          Breathe
        </p>
        <p className="relative z-10 mt-3 animate-fade-in text-sm text-muted-foreground animation-delay-300">
          Next exercise coming...
        </p>
      </div>
    )
  }

  const accent = sessionType ? getSessionAccent(sessionType) : '#E8C860'
  const label = sessionType ? getSessionLabel(sessionType, sessionDayOfWeek) : ''
  const markAsset = sessionType ? getMarkAsset(sessionType) : null

  // ─── Session atmosphere (shared across types) ─────────────

  function SessionAtmosphere() {
    return (
      <>
        <SessionBackground accentColor={accent} />
        {markAsset && (
          <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center">
            <img src={markAsset.png} alt="" className="h-64 w-64 object-contain opacity-[0.04]" />
          </div>
        )}
      </>
    )
  }

  // ─── Session header (shared across types) ─────────────────

  function SessionHeader({ counter }: { counter?: string }) {
    return (
      <header className="flex shrink-0 items-center justify-between px-4 py-3">
        <button onClick={() => navigate('/today')} className="text-sm font-medium text-muted-foreground active:text-teal">
          Back
        </button>
        {counter && (
          <span className="text-label" style={{ color: accent }}>
            {counter}
          </span>
        )}
      </header>
    )
  }

  // ─── Progress bar (shared) ────────────────────────────────

  function ProgressBar({ value }: { value: number }) {
    return (
      <div className="h-1 bg-surface">
        <div
          className="h-full transition-all duration-300"
          style={{ width: `${value}%`, backgroundColor: accent }}
        />
      </div>
    )
  }

  // ─── Foundation Run (combined zone 2 + posture) ─────────────

  if (sessionType === 'foundation_run' && foundationRunData) {
    const frExercises = foundationRunData.postureExercises
    const frTotalExercises = frExercises.length
    const frCurrentExercise = frExercises[exerciseIdx]
    const frTotalSets = frCurrentExercise?.sets ?? 1

    const frPrevExercise = exerciseIdx > 0 ? frExercises[exerciseIdx - 1] : null
    const frShowSectionHeader = !frPrevExercise || frPrevExercise.section !== frCurrentExercise?.section

    function handleFrPostureSetDone() {
      if (!frCurrentExercise) return
      apiFetch(`/api/posture-exercises/${frCurrentExercise.id}`, {
        method: 'PATCH', body: JSON.stringify({ completed: 1 }),
      }).catch(console.error)

      const isLastSet = (setIdx + 1) >= frTotalSets
      const isLastExercise = exerciseIdx >= frTotalExercises - 1

      if (isLastSet && isLastExercise) {
        setPhase('mark-earned')
      } else if (isLastSet) {
        setPhase('breathe')
        setSetIdx(0)
        setTimeout(() => {
          setExerciseIdx(prev => prev + 1)
          setPhase('fr-posture')
        }, 3000)
      } else {
        setSetIdx(prev => prev + 1)
      }
    }

    // Calculate progress across both phases
    let frProgress = 0
    if (phase === 'fr-run') frProgress = 10
    else if (phase === 'fr-transition') frProgress = 25
    else if (phase === 'fr-posture' || phase === 'breathe') {
      frProgress = 25 + ((exerciseIdx / frTotalExercises) * 65)
    } else if (phase === 'mark-earned' || phase === 'complete') frProgress = 100

    return (
      <div className="relative flex min-h-screen flex-col bg-near-black text-foreground">
        <SessionAtmosphere />
        <SessionHeader counter={
          phase === 'fr-posture' || phase === 'breathe'
            ? `${exerciseIdx + 1} / ${frTotalExercises}`
            : phase === 'fr-run' ? 'Run' : undefined
        } />
        <main className="relative z-10 flex-1 overflow-auto px-4 py-4">
          {phase === 'entrance' && (
            <RitualEntrance sessionType="foundation_run" onComplete={() => setPhase('fr-run')} />
          )}
          {phase === 'mark-earned' && (
            <MarkEarnedOverlay sessionType="foundation_run" onComplete={() => setPhase('complete')} />
          )}
          {phase === 'complete' && (
            <SessionComplete sessionType="foundation_run" onFinish={handleFinish} submitting={submitting} />
          )}
          {phase === 'fr-run' && foundationRunData.runSession && (
            <RunSessionView
              runSession={foundationRunData.runSession}
              prescription={foundationRunData.prescription}
              onComplete={() => setPhase('fr-transition')}
            />
          )}
          {phase === 'fr-transition' && (
            <FrTransition onComplete={() => setPhase('fr-posture')} />
          )}
          {(phase === 'fr-posture' || phase === 'breathe') && frCurrentExercise && (
            <>
              {phase === 'breathe' ? (
                <div className="flex flex-col items-center justify-center py-16 animate-fade-in">
                  <p className="text-display text-teal">Breathe</p>
                  <p className="mt-2 text-sm text-muted-foreground">Next exercise coming...</p>
                </div>
              ) : (
                <PostureExerciseView
                  exercise={frCurrentExercise}
                  exerciseIndex={exerciseIdx}
                  totalExercises={frTotalExercises}
                  currentSet={setIdx}
                  showSectionHeader={frShowSectionHeader}
                  onSetDone={handleFrPostureSetDone}
                />
              )}
            </>
          )}
        </main>
        <ProgressBar value={frProgress} />
      </div>
    )
  }

  // ─── Posture workout ───────────────────────────────────────

  if (sessionType === 'posture_corrective' && postureData) {
    const exercises = postureData.exercises
    const totalExercises = exercises.length
    const currentExercise = exercises[exerciseIdx]
    const totalSets = currentExercise?.sets ?? 1

    // Determine if we're showing a new section header
    const prevExercise = exerciseIdx > 0 ? exercises[exerciseIdx - 1] : null
    const showSectionHeader = !prevExercise || prevExercise.section !== currentExercise?.section

    function handlePostureSetDone() {
      if (currentExercise) {
        apiFetch(`/api/posture-exercises/${currentExercise.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ completed: 1 }),
        }).catch(console.error)
      }

      const isLastSet = setIdx >= totalSets - 1
      const isLastExercise = exerciseIdx >= totalExercises - 1

      if (isLastSet && isLastExercise) {
        setPhase('mark-earned')
      } else if (isLastSet) {
        // Show breathing cue between exercises
        setPhase('breathe')
        setTimeout(() => {
          setExerciseIdx(exerciseIdx + 1)
          setSetIdx(0)
          setPhase('exercise')
        }, 3000)
      } else {
        setSetIdx(setIdx + 1)
      }
    }

    const progress = totalExercises > 0
      ? ((exerciseIdx * totalSets + setIdx) / (totalExercises * totalSets)) * 100
      : 0

    return (
      <div className="relative flex min-h-screen flex-col bg-near-black text-foreground">
        <SessionAtmosphere />
        <SessionHeader counter={`${exerciseIdx + 1}/${totalExercises}`} />
        <main className="relative z-10 flex-1 overflow-auto px-4 py-4">
          {phase === 'complete' ? (
            <SessionComplete sessionType={sessionType} onFinish={handleFinish} submitting={submitting} />
          ) : currentExercise ? (
            <PostureExerciseView
              key={`${exerciseIdx}-${setIdx}`}
              exercise={currentExercise}
              exerciseIndex={exerciseIdx}
              totalExercises={totalExercises}
              currentSet={setIdx + 1}
              showSectionHeader={showSectionHeader}
              onSetDone={handlePostureSetDone}
            />
          ) : null}
        </main>
        <ProgressBar value={progress} />
      </div>
    )
  }

  // ─── MT class workout ───────────────────────────────────────

  if (sessionType === 'mt_class' && mtData?.mtLog) {
    return (
      <div className="relative flex min-h-screen flex-col bg-near-black text-foreground">
        <SessionAtmosphere />
        <SessionHeader />
        <main className="relative z-10 flex-1 overflow-auto px-4 py-4">
          {phase === 'complete' ? (
            <SessionComplete sessionType={sessionType} onFinish={handleFinish} submitting={submitting} />
          ) : (
            <MtClassLogView mtLog={mtData.mtLog} onComplete={() => setPhase('mark-earned')} />
          )}
        </main>
        <ProgressBar value={phase === 'complete' ? 100 : 50} />
      </div>
    )
  }

  // ─── Running workout ────────────────────────────────────────

  if (sessionType === 'running' && runData?.runSession) {
    return (
      <div className="relative flex min-h-screen flex-col bg-near-black text-foreground">
        <SessionAtmosphere />
        <SessionHeader />
        <main className="relative z-10 flex-1 overflow-auto px-4 py-4">
          {phase === 'complete' ? (
            <SessionComplete sessionType={sessionType} onFinish={handleFinish} submitting={submitting} />
          ) : (
            <RunSessionView
              runSession={runData.runSession}
              prescription={runData.prescription}
              onComplete={() => setPhase('mark-earned')}
            />
          )}
        </main>
        <ProgressBar value={phase === 'complete' ? 100 : 0} />
      </div>
    )
  }

  // ─── Skip rope workout ──────────────────────────────────────

  if (sessionType === 'skip_rope' && skipData?.skipSession) {
    return (
      <div className="relative flex min-h-screen flex-col bg-near-black text-foreground">
        <SessionAtmosphere />
        <SessionHeader />
        <main className="relative z-10 flex-1 overflow-auto px-4 py-4">
          {phase === 'complete' ? (
            <SessionComplete sessionType={sessionType} onFinish={handleFinish} submitting={submitting} />
          ) : (
            <SkipRopeView skipSession={skipData.skipSession} onComplete={() => setPhase('mark-earned')} />
          )}
        </main>
        <ProgressBar value={phase === 'complete' ? 100 : 0} />
      </div>
    )
  }

  // ─── Active recovery workout ───────────────────────────────

  if (sessionType === 'active_recovery' && recoveryData?.recoverySession) {
    return (
      <div className="relative flex min-h-screen flex-col bg-near-black text-foreground">
        <SessionAtmosphere />
        <SessionHeader />
        <main className="relative z-10 flex-1 overflow-auto px-4 py-4">
          {phase === 'complete' ? (
            <SessionComplete sessionType={sessionType} onFinish={handleFinish} submitting={submitting} />
          ) : (
            <ActiveRecoveryView recoverySession={recoveryData.recoverySession} onComplete={() => setPhase('mark-earned')} />
          )}
        </main>
        <ProgressBar value={phase === 'complete' ? 100 : 0} />
      </div>
    )
  }

  // ─── Bag work workout ───────────────────────────────────────

  if (sessionType === 'bag_work' && bagData) {
    const rounds = bagData.rounds
    const totalRounds = rounds.length
    const currentRound = rounds[roundIdx]
    const bagProgress = totalRounds > 0 ? (roundIdx / totalRounds) * 100 : 0

    // Collect all combos for rating screen
    const allCombosForRating = rounds.flatMap(r =>
      r.combos.filter(rc => rc.combo).map(rc => ({
        comboId: rc.combo!.id,
        roundId: r.id,
        text: rc.combo!.text,
      }))
    )

    async function handleBagWorkComplete() {
      // Go to rating screen instead of mark-earned
      setPhase('combo-rating')
    }

    async function handleRatingComplete(newFavourites: string[]) {
      // Check for unlock suggestions
      try {
        const result = await apiFetch<{ suggestions: UnlockSuggestion[]; message: string | null }>(
          `/api/sessions/${id}/suggest-unlocks`,
          { method: 'POST' }
        )
        if (result.suggestions.length > 0 && result.message) {
          setUnlockSuggestions({ suggestions: result.suggestions, message: result.message })
          setPhase('combo-unlock')
          return
        }
      } catch { /* ignore */ }
      setPhase('mark-earned')
    }

    // Preview phase: show all rounds before starting
    if (phase === 'bag-preview') {
      return (
        <div className="relative flex min-h-screen flex-col bg-near-black text-foreground">
          <SessionAtmosphere />
          <SessionHeader />
          <main className="relative z-10 flex-1 overflow-auto px-4 py-4">
            <div className="animate-fade-in space-y-4">
              <div className="text-center">
                <p className="font-cinzel text-xl tracking-wider text-foreground">Bag Work Preview</p>
                <p className="mt-1 text-xs text-muted-foreground">{totalRounds} rounds. Tap a combo to re-roll</p>
              </div>
              {rounds.map((round) => (
                <div key={round.id} className="rounded-md border border-border bg-deep-forest p-3">
                  <p className="mb-2 text-xs font-medium text-gold/60">Round {round.roundNumber}</p>
                  {round.combos.map((rc) => (
                    <div key={rc.id} className="mb-1.5 flex items-center justify-between last:mb-0">
                      <span className="text-sm text-foreground">{rc.combo?.text ?? 'Unknown'}</span>
                      <button
                        onClick={async () => {
                          if (!rc.combo) return
                          try {
                            const result = await apiFetch<{ combo: BagComboData['combo'] }>(
                              `/api/sessions/${id}/swap-combo`,
                              { method: 'POST', body: JSON.stringify({ roundId: round.id, oldComboId: rc.combo.id }) }
                            )
                            // Update local state
                            setBagData(prev => {
                              if (!prev) return prev
                              return {
                                ...prev,
                                rounds: prev.rounds.map(r => r.id === round.id ? {
                                  ...r,
                                  combos: r.combos.map(c => c.id === rc.id ? { ...c, combo: result.combo } : c),
                                } : r),
                              }
                            })
                          } catch (e) {
                            console.error('Failed to swap combo:', e)
                          }
                        }}
                        className="ml-2 text-xs text-muted-foreground active:text-gold"
                      >
                        ↻
                      </button>
                    </div>
                  ))}
                </div>
              ))}
              <Button onClick={() => setPhase('exercise')} size="lg" className="w-full">
                Begin Session
              </Button>
            </div>
          </main>
        </div>
      )
    }

    // Combo rating phase
    if (phase === 'combo-rating') {
      return (
        <div className="relative flex min-h-screen flex-col bg-near-black text-foreground">
          <SessionAtmosphere />
          <SessionHeader />
          <main className="relative z-10 flex-1 overflow-auto px-4 py-4">
            <ComboRatingScreen
              sessionId={id!}
              combos={allCombosForRating}
              onComplete={handleRatingComplete}
            />
          </main>
          <ProgressBar value={100} />
        </div>
      )
    }

    // Combo unlock suggestion phase
    if (phase === 'combo-unlock' && unlockSuggestions) {
      return (
        <div className="relative flex min-h-screen flex-col bg-near-black text-foreground">
          <SessionAtmosphere />
          <SessionHeader />
          <main className="relative z-10 flex-1 overflow-auto px-4 py-4">
            <ComboUnlockSuggestion
              suggestions={unlockSuggestions.suggestions}
              message={unlockSuggestions.message}
              onDone={() => setPhase('mark-earned')}
            />
          </main>
          <ProgressBar value={100} />
        </div>
      )
    }

    return (
      <div className="relative flex min-h-screen flex-col bg-near-black text-foreground">
        <SessionAtmosphere />
        <SessionHeader counter={`Round ${roundIdx + 1}/${totalRounds}`} />
        <main className="relative z-10 flex-1 overflow-auto px-4 py-4">
          {phase === 'complete' ? (
            <SessionComplete sessionType={sessionType} onFinish={handleFinish} submitting={submitting} />
          ) : currentRound ? (
            <BagWorkRoundView
              key={roundIdx}
              round={currentRound}
              totalRounds={totalRounds}
              phase={roundPhase}
              onPhaseChange={setRoundPhase}
              onNextRound={() => {
                setRoundIdx(roundIdx + 1)
                setRoundPhase('ready')
              }}
              onComplete={handleBagWorkComplete}
            />
          ) : null}
        </main>
        <ProgressBar value={bagProgress} />
      </div>
    )
  }

  // ─── Strength workout ──────────────────────────────────────

  if (!strengthData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-near-black">
        <p className="text-sm text-muted-foreground">No workout data found.</p>
      </div>
    )
  }

  const currentExercise = strengthData.exercises[exerciseIdx]
  const currentSet = currentExercise?.sets[setIdx]
  const totalExercises = strengthData.exercises.length
  const totalSetsForExercise = currentExercise?.sets.length ?? 0

  // Check if we're entering a new section
  const prevExercise = exerciseIdx > 0 ? strengthData.exercises[exerciseIdx - 1] : null
  const currentSection = currentExercise?.section
  const showSectionHeader = !prevExercise || prevExercise.section !== currentSection

  function handleSetComplete(weightKg: number | null, reps: number) {
    if (!currentSet) return

    apiFetch(`/api/strength-sets/${currentSet.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        weightKg,
        reps,
        completedAt: Math.floor(Date.now() / 1000),
      }),
    }).catch(console.error)

    const restSec = currentSet.restSec ?? 60
    restTimer.start(restSec)
    scheduleStrengthRestEnd(restSec)
    setPhase('rest')
  }

  function handleNextSet() {
    restTimer.stop()
    cancelStrengthRestEnd()

    const isLastSet = setIdx >= totalSetsForExercise - 1
    const isLastExercise = exerciseIdx >= totalExercises - 1

    if (isLastSet && isLastExercise) {
      setPhase('mark-earned')
    } else if (isLastSet) {
      setExerciseIdx(exerciseIdx + 1)
      setSetIdx(0)
      setPhase('exercise')
    } else {
      setSetIdx(setIdx + 1)
      setPhase('exercise')
    }
  }

  const strengthProgress = totalExercises > 0
    ? ((exerciseIdx * 3 + setIdx) / Math.max(1, totalExercises * 3)) * 100
    : 0

  return (
    <div className="relative flex min-h-screen flex-col bg-near-black text-foreground">
      <SessionAtmosphere />
      <SessionHeader counter={`${exerciseIdx + 1}/${totalExercises}`} />
      <main className="relative z-10 flex-1 overflow-auto px-4 py-4">
        {phase === 'complete' ? (
          <SessionComplete sessionType={sessionType!} onFinish={handleFinish} submitting={submitting} />
        ) : phase === 'rest' ? (
          <div className="animate-fade-in">
            <ExerciseView
              name={currentExercise.exercise?.name ?? ''}
              formCues={null}
              equipment={null}
              notes={null}
              exerciseIndex={exerciseIdx}
              totalExercises={totalExercises}
            />
            <RestTimer
              totalSeconds={currentSet?.restSec ?? 60}
              secondsRemaining={restTimer.secondsRemaining}
              isOvertime={restTimer.isOvertime}
              onNext={handleNextSet}
              accentColor={accent}
            />
          </div>
        ) : (
          <div className="animate-fade-in">
            {/* Section divider */}
            {showSectionHeader && currentSection && (
              <div className="mb-5 pb-2">
                <h3 className={`font-cinzel text-sm font-semibold tracking-[0.2em] ${currentSection === 'core' ? 'text-gold' : 'text-gold/70'}`}>
                  {SECTION_LABELS[currentSection] ?? currentSection.toUpperCase()}
                </h3>
                {currentSection === 'core' && (
                  <p className="mt-1 text-xs text-muted-foreground">15-18 min dedicated block</p>
                )}
                <GoldDivider className="mt-2" />
              </div>
            )}

            <ExerciseView
              name={currentExercise.exercise?.name ?? ''}
              formCues={currentExercise.exercise?.formCues ?? null}
              equipment={currentExercise.exercise?.equipment ?? null}
              notes={currentExercise.notes}
              formVideoUrl={currentExercise.exercise?.formVideoUrl}
              section={currentExercise.section}
              exerciseIndex={exerciseIdx}
              totalExercises={totalExercises}
              prescription={currentExercise.prescription ? (() => {
                const rx = currentExercise.prescription!
                const weightLbs = rx.prescribedWeightKg ? Math.round(kgToLbs(rx.prescribedWeightKg)) : null
                const tmLbs = rx.trainingMaxKg ? Math.round(kgToLbs(rx.trainingMaxKg)) : null
                const isBarbell = currentExercise.exercise?.equipment === 'barbell'
                return {
                  weightLbs,
                  tmLbs,
                  setsReps: rx.setsReps,
                  plateMath: isBarbell && weightLbs ? calculatePlates(weightLbs).plates : null,
                  wavePercentage: rx.wavePercentage,
                  section: currentExercise.section ?? 'main',
                }
              })() : undefined}
              history={(() => {
                const h = exerciseHistories.get(currentExercise.exerciseId)
                if (!h) return undefined
                return {
                  lastWeightLbs: h.lastSession ? Math.round(kgToLbs(h.lastSession.weightKg)) : null,
                  lastReps: h.lastSession?.reps ?? null,
                  lastDate: h.lastSession?.date ?? null,
                  prWeightLbs: h.pr ? Math.round(kgToLbs(h.pr.weightKg)) : null,
                  prReps: h.pr?.reps ?? null,
                  prDate: h.pr?.date ?? null,
                  recentTrend: h.recentTrend.map(t => ({ date: t.date, weightLbs: Math.round(kgToLbs(t.maxWeightKg)), avgReps: t.avgReps })),
                  suggestion: h.suggestion ? { message: h.suggestion.message } : null,
                }
              })()}
            >
              {currentSet && (
                <SetTracker
                  setNumber={currentSet.setNumber}
                  totalSets={totalSetsForExercise}
                  isWarmup={currentSet.isWarmup === 1}
                  suggestedWeightKg={currentSet.weightKg}
                  targetReps={currentSet.reps}
                  lastSessionData={(() => {
                    const h = exerciseHistories.get(currentExercise.exerciseId)
                    if (!h?.lastSession) return undefined
                    return { weightLbs: Math.round(kgToLbs(h.lastSession.weightKg)), reps: h.lastSession.reps }
                  })()}
                  suggestion={(() => {
                    const h = exerciseHistories.get(currentExercise.exerciseId)
                    if (!h?.suggestion?.suggestedWeightKg) return undefined
                    return { weightLbs: Math.round(kgToLbs(h.suggestion.suggestedWeightKg)), message: h.suggestion.message }
                  })()}
                  onComplete={handleSetComplete}
                />
              )}
            </ExerciseView>
          </div>
        )}
      </main>
      <ProgressBar value={strengthProgress} />
    </div>
  )
}
