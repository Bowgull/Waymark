import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { apiFetch } from '@/lib/api'

import { ActiveRecoveryView } from './ActiveRecoveryView'
import { BagWorkRoundView } from './BagWorkRoundView'
import { ExerciseView } from './ExerciseView'
import { MtClassLogView } from './MtClassLogView'
import { PostureExerciseView } from './PostureExerciseView'
import { RestTimer } from './RestTimer'
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

interface StrengthExerciseData {
  id: string
  exerciseId: string
  orderIndex: number
  notes: string | null
  exercise: { name: string; formCues: string | null; equipment: string | null } | null
  sets: SetData[]
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
  exercise: { name: string; formCues: string | null; equipment: string | null } | null
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
  combo: { id: string; text: string; tier: string; level: string } | null
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

interface RunWorkoutData {
  session: SessionData
  runSession: RunSessionData | null
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

type Phase = 'exercise' | 'rest' | 'complete'
type RoundPhase = 'ready' | 'fighting' | 'rest'

export function WorkoutPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [sessionType, setSessionType] = useState<string | null>(null)
  const [strengthData, setStrengthData] = useState<StrengthWorkoutData | null>(null)
  const [postureData, setPostureData] = useState<PostureWorkoutData | null>(null)
  const [bagData, setBagData] = useState<BagWorkoutData | null>(null)
  const [runData, setRunData] = useState<RunWorkoutData | null>(null)
  const [skipData, setSkipData] = useState<SkipWorkoutData | null>(null)
  const [recoveryData, setRecoveryData] = useState<RecoveryWorkoutData | null>(null)
  const [mtData, setMtData] = useState<MtClassWorkoutData | null>(null)
  const [loading, setLoading] = useState(true)
  const [exerciseIdx, setExerciseIdx] = useState(0)
  const [setIdx, setSetIdx] = useState(0)
  const [roundIdx, setRoundIdx] = useState(0)
  const [roundPhase, setRoundPhase] = useState<RoundPhase>('ready')
  const [phase, setPhase] = useState<Phase>('exercise')
  const [submitting, setSubmitting] = useState(false)

  const restTimer = useRestTimer()

  useEffect(() => {
    if (!id) return
    async function load() {
      try {
        // Fetch session to determine type
        const allSessions = await apiFetch<SessionData[]>('/api/sessions')
        const session = allSessions.find(s => s.id === id)
        if (!session) throw new Error('Session not found')

        setSessionType(session.type)

        if (session.type === 'posture_corrective') {
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
        }
      } catch (e) {
        console.error('Failed to load workout:', e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

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

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <p className="text-sm text-zinc-500">Loading workout...</p>
      </div>
    )
  }

  // ─── Posture workout ───────────────────────────────────────

  if (sessionType === 'posture_corrective' && postureData) {
    const exercises = postureData.exercises
    const totalExercises = exercises.length
    const currentExercise = exercises[exerciseIdx]
    const totalSets = currentExercise?.sets ?? 1

    function handlePostureSetDone() {
      // Mark exercise completed via API
      if (currentExercise) {
        apiFetch(`/api/posture-exercises/${currentExercise.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ completed: 1 }),
        }).catch(console.error)
      }

      const isLastSet = setIdx >= totalSets - 1
      const isLastExercise = exerciseIdx >= totalExercises - 1

      if (isLastSet && isLastExercise) {
        setPhase('complete')
      } else if (isLastSet) {
        setExerciseIdx(exerciseIdx + 1)
        setSetIdx(0)
      } else {
        setSetIdx(setIdx + 1)
      }
    }

    const progress = totalExercises > 0
      ? ((exerciseIdx * totalSets + setIdx) / (totalExercises * totalSets)) * 100
      : 0

    return (
      <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
        <header className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-3">
          <button onClick={() => navigate('/today')} className="text-sm text-zinc-400 active:text-zinc-200">
            Back
          </button>
          <span className="text-xs text-zinc-500">{exerciseIdx + 1}/{totalExercises}</span>
        </header>

        <main className="flex-1 overflow-auto px-4 py-4">
          {phase === 'complete' ? (
            <SessionComplete onFinish={handleFinish} submitting={submitting} />
          ) : currentExercise ? (
            <PostureExerciseView
              key={`${exerciseIdx}-${setIdx}`}
              exercise={currentExercise}
              exerciseIndex={exerciseIdx}
              totalExercises={totalExercises}
              currentSet={setIdx + 1}
              onSetDone={handlePostureSetDone}
            />
          ) : null}
        </main>

        <div className="h-1 bg-zinc-800">
          <div className="h-full bg-[#4ACAAA] transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      </div>
    )
  }

  // ─── MT class workout ───────────────────────────────────────

  if (sessionType === 'mt_class' && mtData?.mtLog) {
    return (
      <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
        <header className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-3">
          <button onClick={() => navigate('/today')} className="text-sm text-zinc-400 active:text-zinc-200">Back</button>
          <span className="text-xs text-zinc-500">MT Class</span>
        </header>
        <main className="flex-1 overflow-auto px-4 py-4">
          {phase === 'complete' ? (
            <SessionComplete onFinish={handleFinish} submitting={submitting} />
          ) : (
            <MtClassLogView mtLog={mtData.mtLog} onComplete={() => setPhase('complete')} />
          )}
        </main>
        <div className="h-1 bg-[#4ACAAA]" />
      </div>
    )
  }

  // ─── Running workout ────────────────────────────────────────

  if (sessionType === 'running' && runData?.runSession) {
    return (
      <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
        <header className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-3">
          <button onClick={() => navigate('/today')} className="text-sm text-zinc-400 active:text-zinc-200">
            Back
          </button>
          <span className="text-xs text-zinc-500">Run</span>
        </header>

        <main className="flex-1 overflow-auto px-4 py-4">
          {phase === 'complete' ? (
            <SessionComplete onFinish={handleFinish} submitting={submitting} />
          ) : (
            <RunSessionView
              runSession={runData.runSession}
              onComplete={() => setPhase('complete')}
            />
          )}
        </main>

        <div className="h-1 bg-[#1E8A68]" />
      </div>
    )
  }

  // ─── Skip rope workout ──────────────────────────────────────

  if (sessionType === 'skip_rope' && skipData?.skipSession) {
    return (
      <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
        <header className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-3">
          <button onClick={() => navigate('/today')} className="text-sm text-zinc-400 active:text-zinc-200">Back</button>
          <span className="text-xs text-zinc-500">Skip Rope</span>
        </header>
        <main className="flex-1 overflow-auto px-4 py-4">
          {phase === 'complete' ? (
            <SessionComplete onFinish={handleFinish} submitting={submitting} />
          ) : (
            <SkipRopeView skipSession={skipData.skipSession} onComplete={() => setPhase('complete')} />
          )}
        </main>
        <div className="h-1 bg-[#1E8A68]" />
      </div>
    )
  }

  // ─── Active recovery workout ───────────────────────────────

  if (sessionType === 'active_recovery' && recoveryData?.recoverySession) {
    return (
      <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
        <header className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-3">
          <button onClick={() => navigate('/today')} className="text-sm text-zinc-400 active:text-zinc-200">Back</button>
          <span className="text-xs text-zinc-500">Recovery</span>
        </header>
        <main className="flex-1 overflow-auto px-4 py-4">
          {phase === 'complete' ? (
            <SessionComplete onFinish={handleFinish} submitting={submitting} />
          ) : (
            <ActiveRecoveryView recoverySession={recoveryData.recoverySession} onComplete={() => setPhase('complete')} />
          )}
        </main>
        <div className="h-1 bg-zinc-600" />
      </div>
    )
  }

  // ─── Bag work workout ───────────────────────────────────────

  if (sessionType === 'bag_work' && bagData) {
    const rounds = bagData.rounds
    const totalRounds = rounds.length
    const currentRound = rounds[roundIdx]
    const bagProgress = totalRounds > 0 ? (roundIdx / totalRounds) * 100 : 0

    return (
      <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
        <header className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-3">
          <button onClick={() => navigate('/today')} className="text-sm text-zinc-400 active:text-zinc-200">
            Back
          </button>
          <span className="text-xs text-zinc-500">Round {roundIdx + 1}/{totalRounds}</span>
        </header>

        <main className="flex-1 overflow-auto px-4 py-4">
          {phase === 'complete' ? (
            <SessionComplete onFinish={handleFinish} submitting={submitting} />
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
              onComplete={() => setPhase('complete')}
            />
          ) : null}
        </main>

        <div className="h-1 bg-zinc-800">
          <div className="h-full bg-[#E8C860] transition-all duration-300" style={{ width: `${bagProgress}%` }} />
        </div>
      </div>
    )
  }

  // ─── Strength workout ──────────────────────────────────────

  if (!strengthData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <p className="text-sm text-zinc-500">No workout data found.</p>
      </div>
    )
  }

  const currentExercise = strengthData.exercises[exerciseIdx]
  const currentSet = currentExercise?.sets[setIdx]
  const totalExercises = strengthData.exercises.length
  const totalSetsForExercise = currentExercise?.sets.length ?? 0

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
    setPhase('rest')
  }

  function handleNextSet() {
    restTimer.stop()

    const isLastSet = setIdx >= totalSetsForExercise - 1
    const isLastExercise = exerciseIdx >= totalExercises - 1

    if (isLastSet && isLastExercise) {
      setPhase('complete')
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
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-3">
        <button onClick={() => navigate('/today')} className="text-sm text-zinc-400 active:text-zinc-200">
          Back
        </button>
        <span className="text-xs text-zinc-500">{exerciseIdx + 1}/{totalExercises}</span>
      </header>

      <main className="flex-1 overflow-auto px-4 py-4">
        {phase === 'complete' ? (
          <SessionComplete onFinish={handleFinish} submitting={submitting} />
        ) : phase === 'rest' ? (
          <div>
            <ExerciseView
              name={currentExercise.exercise?.name ?? ''}
              formCues={null}
              equipment={null}
              notes={null}
              exerciseIndex={exerciseIdx}
              totalExercises={totalExercises}
            />
            <RestTimer
              secondsRemaining={restTimer.secondsRemaining}
              isOvertime={restTimer.isOvertime}
              onNext={handleNextSet}
            />
          </div>
        ) : (
          <div>
            <ExerciseView
              name={currentExercise.exercise?.name ?? ''}
              formCues={currentExercise.exercise?.formCues ?? null}
              equipment={currentExercise.exercise?.equipment ?? null}
              notes={currentExercise.notes}
              exerciseIndex={exerciseIdx}
              totalExercises={totalExercises}
            />
            {currentSet && (
              <SetTracker
                setNumber={currentSet.setNumber}
                totalSets={totalSetsForExercise}
                isWarmup={currentSet.isWarmup === 1}
                suggestedWeightKg={currentSet.weightKg}
                targetReps={currentSet.reps}
                onComplete={handleSetComplete}
              />
            )}
          </div>
        )}
      </main>

      <div className="h-1 bg-zinc-800">
        <div className="h-full bg-[#E8C860] transition-all duration-300" style={{ width: `${strengthProgress}%` }} />
      </div>
    </div>
  )
}
