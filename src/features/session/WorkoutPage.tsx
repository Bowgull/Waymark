import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { apiFetch } from '@/lib/api'
import { getMarkAsset, getSessionAccent } from '@/lib/markAssets'
import { getRoadBootcampAdaptationLine } from '@/lib/roadBootcampStrengthTemplates'
import { kgToLbs } from '@/lib/units'
import { calculatePlates } from '@/lib/plateMath'
import { scheduleStrengthRestEnd, cancelStrengthRestEnd } from '@/lib/notifications'
import { saveWorkoutProgress, getWorkoutRecovery, clearWorkoutRecovery, validateWorkoutRecovery } from '@/lib/workoutRecovery'
import { logger } from '@/lib/logger'
import { SessionBackground } from '@/components/backgrounds/SessionBackground'
import { Button } from '@/components/ui/button'
import { RingTimer } from '@/components/RingTimer'
import { useToast } from '@/components/ui/Toast'
import { SessionShell } from './SessionShell'

import { ActiveRecoveryView } from './ActiveRecoveryView'
import { BagWorkRoundView } from './BagWorkRoundView'
import { ComboRatingScreen } from './ComboRatingScreen'
import { ComboUnlockSuggestion } from './ComboUnlockSuggestion'
import { MarkEarnedOverlay } from './MarkEarnedOverlay'
import { MtClassLogView } from './MtClassLogView'
import { MobilityExerciseView } from './MobilityExerciseView'
import { RitualEntrance } from './RitualEntrance'
import { RunSessionView } from './RunSessionView'
import { SessionComplete } from './SessionComplete'
import { SkipRopeView } from './SkipRopeView'
import { StrengthExerciseView } from './StrengthExerciseView'
import type { StrengthSection } from './strengthMicrocopy'
import { useRestTimer } from './useRestTimer'
import { useSessionLiveActivity, type LiveActivityConfig } from './useSessionLiveActivity'
import { endLiveActivity, endAllLiveActivities } from '@/lib/liveActivity'

// ─── Shared types ──────────────────────────────────────────────

interface SessionData {
  id: string
  type: string
  status: string
  blockWeek?: number | null
  blockType?: string | null
  contextJson?: string | null
  scheduledDate?: number | null
}

// ─── Strength types ────────────────────────────────────────────

interface SetData {
  id: string
  setNumber: number
  weightKg: number | null
  reps: number
  plannedWeightKg?: number | null
  plannedReps?: number | null
  inferredStatus?: string | null
  bandColor?: string | null
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

// ─── Mobility types ────────────────────────────────────────────

interface MobilityExerciseData {
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

interface MobilityWorkoutData {
  session: SessionData
  exercises: MobilityExerciseData[]
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
  roundType?: string | null
  coachRationale?: string | null
  combos: BagComboData[]
}

interface BagWorkoutData {
  session: SessionData
  rounds: BagRoundData[]
}

// ─── Run types ─────────────────────────────────────────────────

interface RunSessionData {
  id: string
  sessionId?: string
  runType: string | null
  distanceKm: number | null
  durationSec: number | null
  isIndoor: number
  onePaceArc: string | null
  onePaceEp: string | null
  stravaActivityId?: number | null
  attachmentStatus?: string | null
}

interface RunPrescription {
  weekNumber: number
  runType: string
  targetDesc: string
  targetDurSec: number | null
  targetDistKm: number | null
  z2CeilingBpm?: number | null
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
  postureExercises: MobilityExerciseData[]
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

// ─── Phases ────────────────────────────────────────────────────

type Phase = 'entrance' | 'exercise' | 'rest' | 'breathe' | 'mark-earned' | 'complete' | 'bag-preview' | 'bag-warmup' | 'strength-ready' | 'strength-warmup-skip' | 'combo-rating' | 'combo-unlock' | 'fr-warmup' | 'fr-run'
type RoundPhase = 'ready' | 'fighting' | 'rest'
type RoadBootcampTime = '15' | '30' | '45_plus'
type RoadBootcampEquipment = 'no_gym' | 'hotel_gym' | 'full_gym'

function SkipWarmupTimer({ durationSec, onComplete, description }: {
  durationSec: number
  onComplete: () => void
  description?: string
}) {
  const timer = useRestTimer()
  const [started, setStarted] = useState(false)
  const warmupIsOvertime = timer.isOvertime
  const warmupIsRunning = timer.isRunning
  const warmupSecondsRemaining = timer.secondsRemaining
  const stopWarmupTimer = timer.stop

  function handleStart() {
    timer.start(durationSec)
    setStarted(true)
  }

  useEffect(() => {
    if (started && warmupIsRunning && warmupSecondsRemaining <= 0 && !warmupIsOvertime) {
      stopWarmupTimer()
      onComplete()
    }
  }, [onComplete, started, stopWarmupTimer, warmupIsOvertime, warmupIsRunning, warmupSecondsRemaining])

  return (
    <div className="animate-fade-in flex flex-col items-center py-8">
      <p className="text-label mb-1 text-muted-foreground">Warm Up</p>
      <h2 className="text-display-lg text-foreground">Skip Rope</h2>
      {description && (
        <p className="mt-2 max-w-xs text-center text-sm text-muted-foreground">{description}</p>
      )}
      <div className="mt-8">
        <RingTimer
          totalSeconds={durationSec}
          secondsRemaining={started ? timer.secondsRemaining : durationSec}
          isOvertime={timer.isOvertime}
          label={started ? (timer.secondsRemaining <= 10 ? 'Finish' : 'Skip') : 'Warm Up'}
          accentColor={started && timer.secondsRemaining <= 10 ? '#C45A3C' : '#E8C860'}
          isPaused={started && timer.isPaused}
          onTogglePause={
            started ? () => (timer.isPaused ? timer.resume() : timer.pause()) : undefined
          }
        />
      </div>
      {!started ? (
        <Button onClick={handleStart} size="lg" className="mt-6">
          Start Warm Up
        </Button>
      ) : (
        <Button onClick={onComplete} variant="secondary" size="lg" className="mt-6">
          Skip Warm Up
        </Button>
      )}
    </div>
  )
}

export function WorkoutPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [sessionType, setSessionType] = useState<string | null>(null)
  const [strengthData, setStrengthData] = useState<StrengthWorkoutData | null>(null)
  const [mobilityData, setMobilityData] = useState<MobilityWorkoutData | null>(null)
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
  const [roadTime, setRoadTime] = useState<RoadBootcampTime>('30')
  const [roadEquipment, setRoadEquipment] = useState<RoadBootcampEquipment>('no_gym')
  const { show: showToast, ToastContainer } = useToast()

  const restTimer = useRestTimer()

  function exitToToday() {
    try {
      sessionStorage.setItem('waymark_suppress_auto_resume_until', String(Date.now() + 2 * 60 * 1000))
    } catch {
      // sessionStorage can be unavailable in private contexts.
    }
    cancelStrengthRestEnd()
    restTimer.stop()
    void endAllLiveActivities()
    navigate('/today?resume=0', { state: { suppressAutoResume: true } })
  }

  // Live Activity for strength — persists across both rest and exercise
  // phases so the lock screen always shows where the user is.
  const isStrengthSession =
    sessionType != null &&
    sessionType !== 'bag_work' &&
    sessionType !== 'mobility' &&
    sessionType !== 'skip_rope' &&
    sessionType !== 'running' &&
    sessionType !== 'active_recovery' &&
    sessionType !== 'mt_class' &&
    sessionType !== 'foundation_run'
  const strengthActiveExercise = strengthData?.exercises[exerciseIdx]
  const strengthActiveName = strengthActiveExercise?.exercise?.name
  const strengthActiveTotalSets = strengthActiveExercise?.sets.length ?? 0

  // Pending weight/reps from the SetTracker inputs — pushed live so a
  // lock-screen "Complete Set" tap logs the same values the user sees.
  const pendingSetValuesRef = useRef<{ weightKg: number | null; reps: number }>({
    weightKg: null,
    reps: 0,
  })
  const handleLiveValuesChange = useCallback((weightKg: number | null, reps: number) => {
    pendingSetValuesRef.current = { weightKg, reps }
  }, [])

  let strengthActivityConfig: LiveActivityConfig | null = null
  if (isStrengthSession && strengthActiveName) {
    if (phase === 'rest' && restTimer.isRunning) {
      strengthActivityConfig = {
        sessionType: 'strength',
        sessionLabel: 'Strength',
        state: {
          phase: 'rest',
          label: 'Rest',
          detail: strengthActiveName,
          startedAt: restTimer.startedAtMs,
          endsAt: restTimer.endsAtMs,
          isPaused: restTimer.isPaused,
          pausedRemaining: restTimer.isPaused
            ? restTimer.secondsRemaining
            : undefined,
        },
      }
    } else if (phase === 'exercise' && strengthActiveTotalSets > 0) {
      const now = Date.now()
      strengthActivityConfig = {
        sessionType: 'strength',
        sessionLabel: 'Strength',
        state: {
          phase: 'exercise',
          label: `Set ${setIdx + 1} of ${strengthActiveTotalSets}`,
          detail: strengthActiveName,
          exerciseName: strengthActiveName,
          // Timer fields ignored by the widget in exercise phase, but the
          // payload shape requires them.
          startedAt: now,
          endsAt: now,
          isPaused: false,
        },
      }
    }
  }

  useSessionLiveActivity(strengthActivityConfig, {
    onPause: () => {
      cancelStrengthRestEnd()
      restTimer.pause()
    },
    onResume: (newEndsAtMs) => {
      const endsAt = restTimer.resume(newEndsAtMs)
      if (endsAt > Date.now()) void scheduleStrengthRestEnd(endsAt)
    },
    onRestart: () => {
      if (!isStrengthSession || phase !== 'rest') return
      const currentSet = strengthData?.exercises[exerciseIdx]?.sets[setIdx]
      const restSec = currentSet?.restSec ?? 60
      cancelStrengthRestEnd()
      restTimer.start(restSec)
      void scheduleStrengthRestEnd(Date.now() + restSec * 1000)
    },
    onEnd: () => {
      exitToToday()
    },
    onCompleteSet: () => {
      if (phase !== 'exercise') return
      const prescribed = strengthData?.exercises[exerciseIdx]?.sets[setIdx]
      const { weightKg, reps } = pendingSetValuesRef.current
      const finalReps = reps > 0 ? reps : prescribed?.reps ?? 0
      if (finalReps <= 0) return
      const finalWeightKg =
        weightKg != null ? weightKg : prescribed?.weightKg ?? null
      handleSetComplete(finalWeightKg, finalReps)
    },
    onAdvance: () => {
      // "Skip →" during rest — cut the rest short and move on.
      if (phase === 'rest') {
        cancelStrengthRestEnd()
        handleNextSet()
      }
    },
  })

  useEffect(() => {
    if (id) logger.setSessionId(id)
    return () => logger.setSessionId(undefined)
  }, [id])

  useEffect(() => {
    if (!id) return
    async function load() {
      try {
        const allSessions = await apiFetch<SessionData[]>('/api/sessions')
        const session = allSessions.find(s => s.id === id)
        if (!session) throw new Error('Session not found')

        setSessionType(session.type)

        // Skip entrance for in-progress non-strength sessions.
        // Strength recovery is validated after workout rows are loaded.
        if (session.status === 'in_progress' && session.type !== 'strength') {
          const recovery = getWorkoutRecovery(id!)
          if (recovery) {
            setExerciseIdx(recovery.exerciseIdx)
            setSetIdx(recovery.setIdx)
            setRoundIdx(recovery.roundIdx)
            setPhase(recovery.phase as Phase)
          } else {
            setPhase(session.type === 'foundation_run' ? 'fr-warmup' : 'exercise')
          }
        }

        if (session.type === 'foundation_run') {
          let data = await apiFetch<FoundationRunWorkoutData>(`/api/sessions/${id}/foundation-run-workout`)
          if (session.status !== 'completed' && session.status !== 'skipped' && (!data.runSession || data.postureExercises.length === 0)) {
            data = await apiFetch<FoundationRunWorkoutData>(`/api/sessions/${id}/start-foundation-run`, { method: 'POST' })
          }
          setFoundationRunData(data)
        } else if (session.type === 'mobility') {
          let data = await apiFetch<MobilityWorkoutData>(`/api/sessions/${id}/mobility-workout`)
          if (session.status !== 'completed' && session.status !== 'skipped' && data.exercises.length === 0) {
            data = await apiFetch<MobilityWorkoutData>(`/api/sessions/${id}/start-mobility`, { method: 'POST' })
          }
          setMobilityData(data)
        } else if (session.type === 'bag_work') {
          let data = await apiFetch<BagWorkoutData>(`/api/sessions/${id}/bag-workout`)
          if (session.status !== 'completed' && session.status !== 'skipped' && data.rounds.length === 0) {
            data = await apiFetch<BagWorkoutData>(`/api/sessions/${id}/start-bag-work`, { method: 'POST' })
          }
          setBagData(data)
        } else if (session.type === 'running') {
          let data = await apiFetch<RunWorkoutData>(`/api/sessions/${id}/run-workout`)
          if (session.status !== 'completed' && session.status !== 'skipped' && !data.runSession) {
            data = await apiFetch<RunWorkoutData>(`/api/sessions/${id}/start-run`, { method: 'POST' })
          }
          setRunData(data)
        } else if (session.type === 'skip_rope') {
          let data = await apiFetch<SkipWorkoutData>(`/api/sessions/${id}/skip-rope-workout`)
          if (session.status !== 'completed' && session.status !== 'skipped' && !data.skipSession) {
            data = await apiFetch<SkipWorkoutData>(`/api/sessions/${id}/start-skip-rope`, { method: 'POST' })
          }
          setSkipData(data)
        } else if (session.type === 'active_recovery') {
          let data = await apiFetch<RecoveryWorkoutData>(`/api/sessions/${id}/recovery-workout`)
          if (session.status !== 'completed' && session.status !== 'skipped' && !data.recoverySession) {
            data = await apiFetch<RecoveryWorkoutData>(`/api/sessions/${id}/start-recovery`, { method: 'POST' })
          }
          setRecoveryData(data)
        } else if (session.type === 'mt_class') {
          let data = await apiFetch<MtClassWorkoutData>(`/api/sessions/${id}/mt-class-workout`)
          if (session.status !== 'completed' && session.status !== 'skipped' && !data.mtLog) {
            data = await apiFetch<MtClassWorkoutData>(`/api/sessions/${id}/start-mt-class`, { method: 'POST' })
          }
          setMtData(data)
        } else {
          const data = await apiFetch<StrengthWorkoutData>(`/api/sessions/${id}/workout`)
          setStrengthData(data)

          if (data.session.blockType === 'road_bootcamp' && data.exercises.length === 0) {
            setPhase('strength-ready')
            setLoading(false)
            return
          }

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

          if (session.status === 'in_progress') {
            const recovery = getWorkoutRecovery(id!)
            const validRecovery = recovery
              ? validateWorkoutRecovery(recovery, {
                sessionId: id!,
                exerciseSetCounts: data.exercises.map(exercise => exercise.sets.length),
              })
              : null
            if (validRecovery) {
              setExerciseIdx(validRecovery.exerciseIdx)
              setSetIdx(validRecovery.setIdx)
              setRoundIdx(validRecovery.roundIdx)
              setPhase(validRecovery.phase === 'rest' ? 'exercise' : validRecovery.phase as Phase)
            } else {
              clearWorkoutRecovery()
              setExerciseIdx(0)
              setSetIdx(0)
              setRoundIdx(0)
              setPhase('exercise')
            }
          }
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        console.error('Failed to load workout:', e)
        logger.error('session', 'workout load failed', { sessionId: id, message }, 'GET /sessions/:id failed or 404. Workout screen has no data.')
        showToast("Couldn't load workout. Check logs in Settings.", 'warning')
      } finally {
        setLoading(false)
      }
    }
    load()

  }, [id, showToast])

  // Auto-save workout progress for crash recovery
  useEffect(() => {
    if (!id || phase === 'entrance' || phase === 'complete' || phase === 'mark-earned') return
    saveWorkoutProgress({ sessionId: id, exerciseIdx, setIdx, roundIdx, phase })
  }, [id, exerciseIdx, setIdx, roundIdx, phase])

  useEffect(() => {
    if (phase !== 'rest' || !restTimer.isRunning || restTimer.secondsRemaining > 0 || !strengthData) return

    restTimer.stop()
    cancelStrengthRestEnd()

    const totalStrengthExercises = strengthData.exercises.length
    const activeExercise = strengthData.exercises[exerciseIdx]
    const activeSetCount = activeExercise?.sets.length ?? 0
    const isLastSet = setIdx >= activeSetCount - 1
    const isLastExercise = exerciseIdx >= totalStrengthExercises - 1

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
  }, [phase, restTimer, restTimer.isRunning, restTimer.secondsRemaining, strengthData, exerciseIdx, setIdx])

  const handleEntranceComplete = useCallback(() => {
    if (sessionType === 'bag_work') {
      setPhase('bag-preview')
    } else if (strengthData && strengthData.session.blockType === 'road_bootcamp' && strengthData.exercises.length === 0) {
      setPhase('strength-ready')
    } else if (strengthData) {
      setPhase('strength-warmup-skip')
    } else {
      setPhase('exercise')
    }
  }, [sessionType, strengthData])

  const handleMarkEarnedComplete = useCallback(() => {
    setPhase('complete')
  }, [])

  async function handleFinish(rpe: number, notes: string) {
    if (!id) return
    setSubmitting(true)
    logger.sessionEvent('session finish attempt', { sessionId: id, rpe, hasNotes: notes.length > 0 })
    try {
      await apiFetch(`/api/sessions/${id}/complete`, {
        method: 'POST',
        body: JSON.stringify({ rpe, notes }),
      })
      logger.sessionEvent('session finish ok', { sessionId: id })
      clearWorkoutRecovery()
      // Let the Live Activity show a ✓ completion frame for 4s before it
      // dismisses itself from the lock screen.
      const now = Date.now()
      void endLiveActivity(
        {
          phase: 'complete',
          label: 'Session Complete',
          startedAt: now,
          endsAt: now,
          isPaused: false,
          completeMessage: 'Session complete',
        },
        4000,
      )
      navigate('/today', { replace: true })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.error('Failed to complete session:', e)
      logger.error('session', 'session finish failed', { sessionId: id, message }, 'POST /sessions/:id/complete failed. Session state stuck in-progress.')
      showToast("Couldn't save. Check connection and try again.", 'warning')
      setSubmitting(false)
    }
  }

  async function startRoadStrength() {
    if (!id) return
    setSubmitting(true)
    try {
      const data = await apiFetch<StrengthWorkoutData>(`/api/sessions/${id}/start-strength`, {
        method: 'POST',
        body: JSON.stringify({ timeAvailable: roadTime, equipment: roadEquipment }),
      })
      setStrengthData(data)

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
      setExerciseIdx(0)
      setSetIdx(0)
      setPhase('strength-warmup-skip')
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      logger.error('session', 'road strength start failed', { sessionId: id, message }, 'Road Bootcamp strength did not start.')
      showToast("Couldn't start strength. Check logs in Settings.", 'warning')
    } finally {
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
  const markAsset = sessionType ? getMarkAsset(sessionType) : null

  // ─── Session atmosphere (shared across types) ─────────────

  function SessionAtmosphere() {
    return (
      <>
        <SessionBackground accentColor={accent} />
        {markAsset && (
          <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center">
            <img src={markAsset.png} alt="" width={256} height={256} className="h-64 w-64 object-contain opacity-[0.04]" />
          </div>
        )}
      </>
    )
  }

  // ─── Session header (shared across types) ─────────────────

  function SessionHeader({ counter }: { counter?: string }) {
    return (
      <header
        className="flex shrink-0 items-center justify-between px-4 pb-2"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 0.75rem)' }}
      >
        <a
          href="/today?resume=0"
          onPointerUp={(event) => {
            event.preventDefault()
            exitToToday()
          }}
          onClick={(event) => {
            event.preventDefault()
            exitToToday()
          }}
          className="-ml-2 inline-flex min-h-[44px] min-w-[44px] items-center px-3 text-sm font-medium text-muted-foreground active:text-teal"
        >
          Back
        </a>
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

  // ─── Zone 2 (dynamic warmup → easy run) ────────────────────

  if (sessionType === 'foundation_run' && foundationRunData) {
    const frExercises = foundationRunData.postureExercises
    const frTotalExercises = frExercises.length
    const frCurrentExercise = frExercises[exerciseIdx]
    const frTotalSets = frCurrentExercise?.sets ?? 1

    const frPrevExercise = exerciseIdx > 0 ? frExercises[exerciseIdx - 1] : null
    const frShowSectionHeader = !frPrevExercise || frPrevExercise.section !== frCurrentExercise?.section

    function handleFrWarmupSetDone() {
      if (!frCurrentExercise) return
      apiFetch(`/api/mobility-exercises/${frCurrentExercise.id}`, {
        method: 'PATCH', body: JSON.stringify({ completed: 1 }),
      }).catch((e) => {
        const message = e instanceof Error ? e.message : String(e)
        logger.warn('session', 'Zone 2 warmup complete flag persist failed', { exerciseId: frCurrentExercise.id, message }, 'Zone 2 warmup flag did not persist. UI advanced anyway.')
      })

      const isLastSet = (setIdx + 1) >= frTotalSets
      const isLastExercise = exerciseIdx >= frTotalExercises - 1

      if (isLastSet && isLastExercise) {
        // Warmup done → start the run
        setExerciseIdx(0)
        setSetIdx(0)
        setPhase('fr-run')
      } else if (isLastSet) {
        setPhase('breathe')
        setSetIdx(0)
        setTimeout(() => {
          setExerciseIdx(prev => prev + 1)
          setPhase('fr-warmup')
        }, 3000)
      } else {
        setSetIdx(prev => prev + 1)
      }
    }

    // Progress: warmup 0-65%, run 65-100%
    let frProgress = 0
    if (phase === 'fr-warmup') {
      frProgress = (exerciseIdx / frTotalExercises) * 65
    } else if (phase === 'fr-run') {
      frProgress = 75
    } else if (phase === 'mark-earned' || phase === 'complete') {
      frProgress = 100
    }

    return (
      <div className="relative flex min-h-screen flex-col bg-near-black text-foreground">
        <SessionAtmosphere />
        <SessionHeader counter={
          phase === 'fr-warmup'
            ? `${exerciseIdx + 1} / ${frTotalExercises}`
            : phase === 'fr-run' ? 'Run' : undefined
        } />
        <main className="relative z-10 flex-1 overflow-auto px-4 py-4">
          {phase === 'entrance' && (
            <RitualEntrance sessionType="foundation_run" onComplete={() => setPhase('fr-warmup')} />
          )}
          {phase === 'mark-earned' && (
            <MarkEarnedOverlay sessionType="foundation_run" onComplete={() => setPhase('complete')} />
          )}
          {phase === 'complete' && (
            <><SessionComplete sessionType="foundation_run" onFinish={handleFinish} submitting={submitting} /><ToastContainer /></>
          )}
          {phase === 'fr-warmup' && frCurrentExercise && (
            <MobilityExerciseView
              inline
              exercise={frCurrentExercise}
              exerciseIndex={exerciseIdx}
              totalExercises={frTotalExercises}
              currentSet={setIdx}
              showSectionHeader={frShowSectionHeader}
              onSetDone={handleFrWarmupSetDone}
            />
          )}
          {phase === 'fr-run' && foundationRunData.runSession && (
            <RunSessionView
              inline
              runSession={foundationRunData.runSession}
              prescription={foundationRunData.prescription}
              onComplete={() => setPhase('mark-earned')}
            />
          )}
        </main>
        <ProgressBar value={frProgress} />
      </div>
    )
  }

  // ─── Mobility workout ──────────────────────────────────────

  if (sessionType === 'mobility' && mobilityData) {
    const exercises = mobilityData.exercises
    const totalExercises = exercises.length
    const currentExercise = exercises[exerciseIdx]
    const totalSets = currentExercise?.sets ?? 1

    // Determine if we're showing a new section header
    const prevExercise = exerciseIdx > 0 ? exercises[exerciseIdx - 1] : null
    const showSectionHeader = !prevExercise || prevExercise.section !== currentExercise?.section

    function handleMobilitySetDone() {
      if (currentExercise) {
        apiFetch(`/api/mobility-exercises/${currentExercise.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ completed: 1 }),
        }).catch((e) => {
          const message = e instanceof Error ? e.message : String(e)
          logger.warn('session', 'mobility complete flag persist failed', { exerciseId: currentExercise.id, message }, 'Mobility complete flag did not persist. UI advanced anyway.')
        })
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

    // Mobility engine owns its own SessionShell (see MobilityExerciseView).
    // WorkoutPage only intervenes for the complete phase.
    if (phase === 'complete') {
      return (
        <div className="relative flex min-h-screen flex-col bg-near-black text-foreground">
          <SessionAtmosphere />
          <SessionHeader />
          <main className="relative z-10 flex-1 overflow-auto px-4 py-4">
            <><SessionComplete sessionType={sessionType} onFinish={handleFinish} submitting={submitting} /><ToastContainer /></>
          </main>
        </div>
      )
    }

    if (!currentExercise) return null

    return (
      <MobilityExerciseView
        key={`${exerciseIdx}-${setIdx}`}
        exercise={currentExercise}
        exerciseIndex={exerciseIdx}
        totalExercises={totalExercises}
        currentSet={setIdx + 1}
        showSectionHeader={showSectionHeader}
        onSetDone={handleMobilitySetDone}
        onExit={() => navigate('/today')}
      />
    )
  }

  // ─── MT class workout ───────────────────────────────────────
  // MtClassLogView owns its SessionShell. WorkoutPage handles only complete.

  if (sessionType === 'mt_class' && mtData?.mtLog) {
    if (phase === 'complete') {
      return (
        <div className="relative flex min-h-screen flex-col bg-near-black text-foreground">
          <SessionAtmosphere />
          <SessionHeader />
          <main className="relative z-10 flex-1 overflow-auto px-4 py-4">
            <SessionComplete sessionType={sessionType} onFinish={handleFinish} submitting={submitting} />
            <ToastContainer />
          </main>
        </div>
      )
    }
    return (
      <>
        <MtClassLogView
          mtLog={mtData.mtLog}
          onComplete={() => setPhase('mark-earned')}
        />
        <ToastContainer />
      </>
    )
  }

  // ─── Running workout ────────────────────────────────────────
  // RunSessionView owns its SessionShell. WorkoutPage handles only complete.

  if (sessionType === 'running' && runData?.runSession) {
    if (phase === 'complete') {
      return (
        <div className="relative flex min-h-screen flex-col bg-near-black text-foreground">
          <SessionAtmosphere />
          <SessionHeader />
          <main className="relative z-10 flex-1 overflow-auto px-4 py-4">
            <SessionComplete sessionType={sessionType} onFinish={handleFinish} submitting={submitting} />
            <ToastContainer />
          </main>
        </div>
      )
    }
    return (
      <>
        <RunSessionView
          runSession={runData.runSession}
          prescription={runData.prescription}
          onComplete={() => setPhase('mark-earned')}
        />
        <ToastContainer />
      </>
    )
  }

  // ─── Skip rope workout ──────────────────────────────────────
  // SkipRopeView owns its SessionShell.

  if (sessionType === 'skip_rope' && skipData?.skipSession) {
    if (phase === 'complete') {
      return (
        <div className="relative flex min-h-screen flex-col bg-near-black text-foreground">
          <SessionAtmosphere />
          <SessionHeader />
          <main className="relative z-10 flex-1 overflow-auto px-4 py-4">
            <SessionComplete sessionType={sessionType} onFinish={handleFinish} submitting={submitting} />
            <ToastContainer />
          </main>
        </div>
      )
    }
    return (
      <>
        <SkipRopeView skipSession={skipData.skipSession} onComplete={() => setPhase('mark-earned')} />
        <ToastContainer />
      </>
    )
  }

  // ─── Active recovery workout ───────────────────────────────
  // ActiveRecoveryView owns its SessionShell. WorkoutPage handles only complete.

  if (sessionType === 'active_recovery' && recoveryData?.recoverySession) {
    if (phase === 'complete') {
      return (
        <div className="relative flex min-h-screen flex-col bg-near-black text-foreground">
          <SessionAtmosphere />
          <SessionHeader />
          <main className="relative z-10 flex-1 overflow-auto px-4 py-4">
            <SessionComplete sessionType={sessionType} onFinish={handleFinish} submitting={submitting} />
            <ToastContainer />
          </main>
        </div>
      )
    }
    return (
      <>
        <ActiveRecoveryView
          recoverySession={recoveryData.recoverySession}
          onComplete={() => setPhase('mark-earned')}
        />
        <ToastContainer />
      </>
    )
  }

  // ─── Bag work workout ───────────────────────────────────────

  if (sessionType === 'bag_work' && bagData) {
    const rounds = bagData.rounds
    const totalRounds = rounds.length
    const currentRound = rounds[roundIdx]

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

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async function handleRatingComplete(_newFavourites: string[]) {
      // Check for unlock suggestions. If AI is offline or returns garbage, we
      // still progress — the user has already committed the rating (see
      // ComboRating.tsx), so skipping straight to mark-earned is the right
      // fallback. We log it so a broken AI doesn't stay invisible forever.
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
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        logger.warn('session', 'suggest-unlocks failed', { sessionId: id, message }, 'POST /suggest-unlocks failed. Non-blocking, session continues.')
      }
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
                <p className="mt-1 text-xs text-muted-foreground">{totalRounds} rounds</p>
              </div>
              {rounds.map((round) => (
                <div key={round.id} className="rounded-md border border-border bg-deep-forest p-3">
                  <p className="mb-2 text-xs font-medium text-gold/60">Round {round.roundNumber}</p>
                  {round.combos.map((rc) => (
                    <div key={rc.id} className="mb-1.5 last:mb-0">
                      <span className="text-sm text-foreground">{rc.combo?.text ?? 'Unknown'}</span>
                    </div>
                  ))}
                </div>
              ))}
              <Button onClick={() => setPhase('bag-warmup')} size="lg" className="w-full">
                Begin Session
              </Button>
            </div>
          </main>
        </div>
      )
    }

    // Skip rope warmup before bag rounds
    if (phase === 'bag-warmup') {
      return (
        <div className="relative flex min-h-screen flex-col bg-near-black text-foreground">
          <SessionAtmosphere />
          <SessionHeader counter="Warm Up" />
          <main className="relative z-10 flex-1 overflow-auto px-4 py-4">
            <SkipWarmupTimer
              durationSec={300}
              onComplete={() => setPhase('exercise')}
              description="Light and easy. Get the blood flowing before you hit the bag."
            />
          </main>
          <ProgressBar value={5} />
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

    // Complete screen keeps the legacy shell until SessionComplete itself moves.
    if (phase === 'complete') {
      return (
        <div className="relative flex min-h-screen flex-col bg-near-black text-foreground">
          <SessionAtmosphere />
          <SessionHeader counter={`Round ${roundIdx + 1}/${totalRounds}`} />
          <main className="relative z-10 flex-1 overflow-auto px-4 py-4">
            <SessionComplete sessionType={sessionType} onFinish={handleFinish} submitting={submitting} />
            <ToastContainer />
          </main>
        </div>
      )
    }

    // Bag round view owns its own SessionShell.
    return currentRound ? (
      <>
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
        <ToastContainer />
      </>
    ) : null
  }

  // ─── Strength workout ──────────────────────────────────────

  if (!strengthData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-near-black">
        <p className="text-sm text-muted-foreground">No workout data found.</p>
      </div>
    )
  }

  if (phase === 'strength-ready' && strengthData.session.blockType === 'road_bootcamp') {
    const adaptationLine = getRoadBootcampAdaptationLine(roadTime, roadEquipment)

    const timeOptions: Array<{ value: RoadBootcampTime; label: string }> = [
      { value: '15', label: '15m' },
      { value: '30', label: '30m' },
      { value: '45_plus', label: '45+' },
    ]
    const equipmentOptions: Array<{ value: RoadBootcampEquipment; label: string; detail: string }> = [
      { value: 'no_gym', label: 'No gym', detail: 'Bands + bodyweight' },
      { value: 'hotel_gym', label: 'Hotel gym', detail: 'DBs and bench' },
      { value: 'full_gym', label: 'Full gym', detail: 'Barbell and rack' },
    ]

    return (
      <>
        <SessionShell
          sessionType="strength"
          title="Strength"
          counter="Ready"
          moment="Pick the version you can do now."
          footer={
            <Button onClick={startRoadStrength} disabled={submitting} size="lg" className="w-full">
              {submitting ? 'Starting...' : 'Start Strength'}
            </Button>
          }
        >
          <div className="mx-auto max-w-md animate-fade-in">
            <p className="font-cinzel text-[11px] uppercase tracking-[0.28em] text-gold/50">
              Road Strength
            </p>
            <h2 className="mt-1 text-display-lg text-foreground">
              Build today&apos;s session
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-foreground/85">
              Choose the time and equipment you actually have.
            </p>

            <div className="mt-6">
              <p className="text-label mb-2 text-muted-foreground">Time</p>
              <div className="flex items-center gap-3">
                {timeOptions.map(option => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setRoadTime(option.value)}
                    className={`min-h-[44px] flex-1 rounded-md py-3 text-sm font-medium ${
                      roadTime === option.value ? 'bg-teal-dark text-foreground' : 'bg-surface-light text-muted-foreground'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-6">
              <p className="text-label mb-2 text-muted-foreground">Equipment</p>
              <div className="space-y-3">
                {equipmentOptions.map(option => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setRoadEquipment(option.value)}
                    className={`min-h-[56px] w-full rounded-md px-4 py-3 text-left ${
                      roadEquipment === option.value ? 'bg-teal-dark text-foreground' : 'bg-surface-light text-muted-foreground'
                    }`}
                  >
                    <span className="block text-sm font-medium">{option.label}</span>
                    <span className="mt-0.5 block text-xs opacity-75">{option.detail}</span>
                  </button>
                ))}
              </div>
            </div>

            <p className="mt-6 text-sm leading-relaxed text-foreground/80">
              {adaptationLine}
            </p>
          </div>
        </SessionShell>
        <ToastContainer />
      </>
    )
  }

  // Skip rope warmup before strength exercises
  if (phase === 'strength-warmup-skip') {
    return (
      <div className="relative flex min-h-screen flex-col bg-near-black text-foreground">
        <SessionAtmosphere />
        <SessionHeader counter="Warm Up" />
        <main className="relative z-10 flex-1 overflow-auto px-4 py-4">
          <SkipWarmupTimer
            durationSec={180}
            onComplete={() => setPhase('exercise')}
            description="Light and easy. Loosen up before you lift."
          />
        </main>
        <ProgressBar value={2} />
      </div>
    )
  }

  const currentExercise = strengthData.exercises[exerciseIdx]

  if (!currentExercise) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-near-black px-6 text-center">
        <p className="text-sm text-muted-foreground">Workout state expired.</p>
        <button
          onClick={() => {
            clearWorkoutRecovery()
            exitToToday()
          }}
          className="rounded-md border border-gold/20 bg-gold/10 px-5 py-3 text-sm text-gold"
        >
          Back to Today
        </button>
      </div>
    )
  }
  const currentSet = currentExercise?.sets[setIdx]
  const totalExercises = strengthData.exercises.length
  const totalSetsForExercise = currentExercise?.sets.length ?? 0

  // Check if we're entering a new section
  const prevExercise = exerciseIdx > 0 ? strengthData.exercises[exerciseIdx - 1] : null
  const currentSection = currentExercise?.section
  const showSectionHeader = !prevExercise || prevExercise.section !== currentSection

  function handleSetComplete(weightKg: number | null, reps: number, meta?: { bandColor?: string | null }) {
    if (!currentSet) return

    apiFetch(`/api/strength-sets/${currentSet.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        weightKg,
        reps,
        bandColor: meta?.bandColor,
        completedAt: Math.floor(Date.now() / 1000),
      }),
    }).catch((e) => {
      const message = e instanceof Error ? e.message : String(e)
      logger.error('session', 'strength set persist failed', { setId: currentSet.id, message }, 'PATCH /sets/:id failed. Set cached locally, not synced.')
      showToast("Set didn't save. Keep training — we'll retry at finish.", 'warning')
    })

    const restSec = currentSet.restSec ?? 60
    restTimer.start(restSec)
    void scheduleStrengthRestEnd(Date.now() + restSec * 1000)
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

  // Session-wide last-set flag: fires only on the final set of the final exercise.
  const isLastSetOfSession =
    setIdx === totalSetsForExercise - 1 && exerciseIdx === totalExercises - 1

  // Strength complete screen keeps the legacy shell for now.
  if (phase === 'complete') {
    return (
      <div className="relative flex min-h-screen flex-col bg-near-black text-foreground">
        <SessionAtmosphere />
        <SessionHeader counter={`${exerciseIdx + 1}/${totalExercises}`} />
        <main className="relative z-10 flex-1 overflow-auto px-4 py-4">
          <SessionComplete sessionType={sessionType!} onFinish={handleFinish} submitting={submitting} />
          <ToastContainer />
        </main>
      </div>
    )
  }

  // Build display props for StrengthExerciseView.
  const sectionKey = (currentExercise?.section ?? null) as StrengthSection | null

  const prescriptionDisplay = (() => {
    if (!currentExercise?.prescription) return undefined
    const rx = currentExercise.prescription
    const weightLbs = rx.prescribedWeightKg ? Math.round(kgToLbs(rx.prescribedWeightKg)) : null
    const tmLbs = rx.trainingMaxKg ? Math.round(kgToLbs(rx.trainingMaxKg)) : null
    const isBarbell = currentExercise.exercise?.equipment === 'barbell'
    return {
      weightLbs,
      tmLbs,
      setsReps: rx.setsReps,
      plateCounts: isBarbell && weightLbs ? calculatePlates(weightLbs).plateCounts : null,
      wavePercentage: rx.wavePercentage,
    }
  })()

  const historyDisplay = (() => {
    if (!currentExercise) return undefined
    const h = exerciseHistories.get(currentExercise.exerciseId)
    if (!h) return undefined
    return {
      lastWeightLbs: h.lastSession ? Math.round(kgToLbs(h.lastSession.weightKg)) : null,
      lastReps: h.lastSession?.reps ?? null,
      lastDate: h.lastSession?.date ?? null,
      prWeightLbs: h.pr ? Math.round(kgToLbs(h.pr.weightKg)) : null,
      prReps: h.pr?.reps ?? null,
      prDate: h.pr?.date ?? null,
      recentTrend: h.recentTrend.map(t => ({
        date: t.date,
        weightLbs: Math.round(kgToLbs(t.maxWeightKg)),
        avgReps: t.avgReps,
      })),
      suggestion: h.suggestion ? { message: h.suggestion.message } : null,
    }
  })()

  const lastSessionData = (() => {
    if (!currentExercise) return undefined
    const h = exerciseHistories.get(currentExercise.exerciseId)
    if (!h?.lastSession) return undefined
    return {
      weightLbs: Math.round(kgToLbs(h.lastSession.weightKg)),
      reps: h.lastSession.reps,
    }
  })()

  const suggestionDisplay = (() => {
    if (!currentExercise) return undefined
    const h = exerciseHistories.get(currentExercise.exerciseId)
    if (!h?.suggestion?.suggestedWeightKg) return undefined
    return {
      weightLbs: Math.round(kgToLbs(h.suggestion.suggestedWeightKg)),
      message: h.suggestion.message,
    }
  })()

  return (
    <>
      <StrengthExerciseView
        phase={phase === 'rest' ? 'rest' : 'exercise'}
        exerciseIndex={exerciseIdx}
        totalExercises={totalExercises}
        exerciseName={currentExercise.exercise?.name ?? ''}
        exerciseId={currentExercise.exerciseId}
        formCues={currentExercise.exercise?.formCues ?? null}
        equipment={currentExercise.exercise?.equipment ?? null}
        notes={currentExercise.notes}
        formVideoUrl={currentExercise.exercise?.formVideoUrl}
        section={sectionKey}
        showSectionHeader={showSectionHeader}
        setIdx={setIdx}
        isLastSetOfSession={isLastSetOfSession}
        currentSet={currentSet ? {
          setNumber: currentSet.setNumber,
          totalSets: totalSetsForExercise,
          isWarmup: currentSet.isWarmup === 1,
          suggestedWeightKg: currentSet.weightKg,
          targetReps: currentSet.plannedReps ?? currentSet.reps,
          bandColor: currentSet.bandColor,
          restSec: currentSet.restSec ?? 60,
        } : undefined}
        prescription={prescriptionDisplay}
        history={historyDisplay}
        lastSessionData={lastSessionData}
        suggestion={suggestionDisplay}
        restState={phase === 'rest' ? {
          totalSeconds: currentSet?.restSec ?? 60,
          secondsRemaining: restTimer.secondsRemaining,
          isOvertime: restTimer.isOvertime,
          isPaused: restTimer.isPaused,
          onTogglePause: () => {
            if (restTimer.isPaused) {
              const endsAt = restTimer.resume()
              if (endsAt > Date.now()) void scheduleStrengthRestEnd(endsAt)
            } else {
              cancelStrengthRestEnd()
              restTimer.pause()
            }
          },
        } : undefined}
        onSetComplete={handleSetComplete}
        onLiveValuesChange={handleLiveValuesChange}
        onNextSet={handleNextSet}
        onExit={exitToToday}
        accentColor={accent}
      />
      <ToastContainer />
    </>
  )
}
