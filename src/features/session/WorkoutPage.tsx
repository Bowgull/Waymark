import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { getItem as storageGetItem, removeItem as storageRemoveItem, setItem as storageSetItem } from '@/lib/safeStorage'
import { entranceLine, parseRoundSecs, roundSecsKey, withRoundSec } from '@/lib/plannedLength'
import { estimatedMinutes } from '@/lib/coach/sessions'

import { getTodayISO } from '@/lib/dates'
import { apiFetch, newIdempotencyKey } from '@/lib/api'
import { flushOutbox, pendingWrites, queueWrite } from '@/lib/outboxSync'
import { EffortCard } from '@/features/blockZero/EffortCard'
import { asksEffort, effortWrite } from '@/features/blockZero/effort'
import { setPlace } from '@/lib/setPlace'
import { kgToLbs } from '@/lib/units'
import { scheduleStrengthRestEnd, cancelStrengthRestEnd, cancelAllCues } from '@/lib/notifications'
import { loadOutbox } from '@/lib/outbox'
import { rollStepSecs } from '@/lib/activeRecoveryTemplate'
import { soundRoundStart } from '@/lib/sounds'
import { useWakeLock } from '@/lib/wakeLock'
import {
  SKIP_ROPE_REST_SEC as SKIP_REST_SEC,
  clampStrengthPosition,
  clearResume,
  deriveMobilityPosition,
  deriveStrengthPosition,
  engineForType,
  isResumablePhase,
  isStaleCue,
  loadResume,
  nextStrengthPosition,
  restoreForNow,
  resumeDecision,
  saveResume,
  type EngineState,
  type RoundSpec,
  type SessionResumeState,
  type StorageLike,
  type TimerSnap,
} from '@/lib/sessionResume'
import { logger } from '@/lib/logger'
import { SessionBackground } from '@/components/backgrounds/SessionBackground'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/Toast'
import { GrassZone, SessionButton, SessionFrame, TimerFace, type TimerTrack } from '@/components/timers'
import { FlapLabel, SESSION_ICON_NAME, armCascade, sessionIconFor } from '@/design'
import { heatFor, momentLine, workLabel } from '@/lib/timers/timerLook'
import { talkTestDue, TALK_TEST_WEEKS } from '@/lib/blockZero/talkTest'

import { ActiveRecoveryView } from './ActiveRecoveryView'
import { BagPreviewCard } from './BagPreviewCard'
import { BagWorkRoundView } from './BagWorkRoundView'
import { BreatheScreen } from './BreatheScreen'
import { ComboRatingScreen } from './ComboRatingScreen'
import { ComboUnlockSuggestion } from './ComboUnlockSuggestion'
import { MtClassLogView } from './MtClassLogView'
import { MobilityExerciseView } from './MobilityExerciseView'
import { RitualEntrance } from './RitualEntrance'
import { RunSessionView } from './RunSessionView'
import { SessionComplete } from './SessionComplete'
import { SessionMoment } from './SessionMoment'
import { SkipRopeView } from './SkipRopeView'
import { StrengthExerciseView } from './StrengthExerciseView'
import type { StrengthSection } from './strengthMicrocopy'
import { useRestTimer } from './useRestTimer'
import { useSessionLiveActivity, type LiveActivityConfig } from './useSessionLiveActivity'
import { endLiveActivity, endAllLiveActivities } from '@/lib/liveActivity'
import { coachLine } from '@/lib/coachLine'

// ─── Shared types ──────────────────────────────────────────────

interface SessionData {
  id: string
  type: string
  status: string
  blockWeek?: number | null
  blockType?: string | null
  scheduledDate?: number | null
  label?: string | null
  notes?: string | null
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
  /** The planned length (min), from the prescription (the server sends it). */
  plannedMin?: number | null
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
  /** The planned length (min), from the prescription (the server sends it). */
  plannedMin?: number | null
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
  /** The planned length (min), from the prescription (the server sends it). */
  plannedMin?: number | null
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
  runWalk?: { runSec: number; walkSec: number; rounds: number; warmupSec: number } | null
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
  /** The planned length (min), from the prescription (the server sends it). */
  plannedMin?: number | null
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
  /** Planned class length (min), the default for the class-length field. */
  plannedMin?: number | null
}

// ─── Phases ────────────────────────────────────────────────────

type Phase = 'entrance' | 'exercise' | 'rest' | 'breathe' | 'mark-earned' | 'complete' | 'bag-preview' | 'bag-warmup' | 'strength-warmup-skip' | 'combo-rating' | 'combo-unlock' | 'fr-warmup' | 'fr-run'
type RoundPhase = 'ready' | 'fighting' | 'rest'

/**
 * The skip-rope warm-up before bag work or strength (page 31 "Rope warm-up"):
 * WARM UP with the rope icon, SKIP ROPE and its line, the clock on the grass.
 * Before you start: START WARM UP. Running: SKIP, then FINISH with the heat in
 * the last 10 s; SKIP WARM UP moves on (so does a swipe up the grass).
 */
function SkipWarmupTimer({ durationSec, onComplete, description, resume, onPersist, onExit }: {
  durationSec: number
  onComplete: () => void
  description?: string
  resume?: TimerSnap | null
  onPersist?: (state: EngineState) => void
  onExit?: () => void
}) {
  const timer = useRestTimer()
  const [started, setStarted] = useState(() => resume != null)
  const warmupIsOvertime = timer.isOvertime
  const warmupIsRunning = timer.isRunning
  const warmupSecondsRemaining = timer.secondsRemaining
  const stopWarmupTimer = timer.stop

  // Resume: the warm-up clock carries on from its saved end time.
  const restoredRef = useRef(false)
  const restoreTimer = timer.restore
  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    if (resume) restoreTimer(resume)
  }, [restoreTimer, resume])

  const warmupSnapshot = timer.snapshot
  useEffect(() => {
    onPersist?.({ kind: 'warmup', timer: warmupSnapshot() })
  }, [onPersist, warmupSnapshot, timer.isRunning, timer.isPaused, timer.endsAtMs])

  useWakeLock(started && timer.isRunning && !timer.isPaused)

  function handleStart() {
    timer.start(durationSec)
    setStarted(true)
  }

  useEffect(() => {
    if (started && warmupIsRunning && !timer.isPaused && warmupSecondsRemaining <= 0 && !warmupIsOvertime) {
      stopWarmupTimer()
      onComplete()
    }
  }, [onComplete, started, stopWarmupTimer, timer.isPaused, warmupIsOvertime, warmupIsRunning, warmupSecondsRemaining])

  const running = started && timer.isRunning
  const shown = running ? Math.max(0, timer.secondsRemaining) : durationSec
  const heat = running ? heatFor(shown) : null
  const track: TimerTrack = running
    ? { durationSec, endsAtMs: timer.isPaused ? null : timer.endsAtMs, remainingMs: timer.secondsRemaining * 1000 }
    : { durationSec, endsAtMs: null, remainingMs: durationSec * 1000 }
  const togglePause = () => { if (timer.isPaused) timer.resume(); else timer.pause() }

  return (
    <SessionFrame
      title="WARM UP"
      icon="rope"
      onEnd={onExit}
      paused={running && timer.isPaused}
      grass={<GrassZone track={track} kind="work" mode={running ? 'work' : 'ready'} heat={heat} onTap={running ? togglePause : undefined} onSkip={running ? onComplete : undefined} />}
    >
      <div className="tm-center" style={{ marginTop: 14 }}>
        <FlapLabel text="SKIP ROPE" size="md" />
        {description && <p className="wm-prose is-dim" style={{ margin: '8px 22px 0' }}>{description}</p>}
      </div>
      <TimerFace seconds={shown} kind="work" heat={heat} label={running ? workLabel('SKIP', shown) : 'READY'} labelTone="gold" track={track} compact />
      <div className="tm-wide">
        {running
          ? <SessionButton label="SKIP WARM UP" onClick={onComplete} />
          : <SessionButton label="START WARM UP" primary onClick={handleStart} />}
      </div>
    </SessionFrame>
  )
}

/** The phases each engine can render. Anything else (an old save) is mapped onto one. */
function normalizePhase(type: string, phase: string): Phase {
  if (phase === 'mark-earned' || phase === 'combo-unlock') return 'complete'
  if (phase === 'complete') return 'complete'
  switch (type) {
    case 'foundation_run':
      return phase === 'fr-run' ? 'fr-run' : 'fr-warmup'
    case 'bag_work':
      return phase === 'bag-preview' || phase === 'bag-warmup' || phase === 'combo-rating' ? phase : 'exercise'
    case 'strength':
      return phase === 'strength-warmup-skip' || phase === 'rest' ? phase : 'exercise'
    default:
      return 'exercise'
  }
}

function resumeStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** Set ids whose log is still waiting in this phone's outbox (count as logged). */
function locallyLoggedSetIds(sessionId: string): Set<string> {
  const ids = new Set<string>()
  try {
    for (const entry of loadOutbox(resumeStorage())) {
      if (entry.sessionId !== sessionId || entry.kind !== 'set') continue
      const m = entry.path.match(/\/api\/strength-sets\/([^/?]+)/)
      if (m) ids.add(m[1])
    }
  } catch {
    // no outbox
  }
  return ids
}

export function WorkoutPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [sessionType, setSessionType] = useState<string | null>(null)
  // Runs keep their category in notes: the entrance shows the Zone 2 dial or the shoe.
  const [runCategory, setRunCategory] = useState<string | null>(null)
  const [sessionLabel, setSessionLabel] = useState<string | null>(null)
  // The entrance's length line (page 19): "6 ROUNDS · 40 MIN", "WEEK 3 · 45 MIN".
  const [entranceDetail, setEntranceDetail] = useState<string | null>(null)
  // The close (page 19 #6): after the effort is saved, the moment plays, then Today.
  const [moment, setMoment] = useState<string | null>(null)
  // Block Zero week 1 / 6: the week's first easy run-walk asks the talk-test HR on its log (page 45 #3).
  const [talkTest, setTalkTest] = useState<{ blockId: string; week: number } | null>(null)
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
  // Saved engine state handed to the engine view that mounts first after a resume.
  const [engineResume, setEngineResume] = useState<EngineState | null>(null)
  // A session saved more than RESUME_AUTO_MAX_MS ago: ask resume or end.
  const [staleResume, setStaleResume] = useState<SessionResumeState | null>(null)
  const pendingRestoreRef = useRef<(() => void) | null>(null)
  const { show: showToast, ToastContainer } = useToast()
  // Per-set effort (Block Zero Phase C): after LOG SET, the reps-left card; rest starts on the tap.
  const [effortFor, setEffortFor] = useState<{ setId: string; label: string } | null>(null)
  // One Idempotency-Key per finish of this session: a double tap or a retry is the same write.
  const finishKeyRef = useRef(newIdempotencyKey())

  const restTimer = useRestTimer()

  // ─── Resume persistence ─────────────────────────────────────
  // Saved on every step: WorkoutPage's position plus the engine view's own
  // state (timer end times, sub-phase, drafts). Armed once the load (and any
  // restore) is done, so defaults never overwrite a saved session.
  const armedRef = useRef(false)
  const posRef = useRef({ phase: 'entrance' as Phase, exerciseIdx: 0, setIdx: 0, roundIdx: 0 })
  const engineStateRef = useRef<EngineState | null>(null)

  const writeResume = useCallback(() => {
    if (!id || !sessionType || !armedRef.current) return
    const pos = posRef.current
    if (!isResumablePhase(pos.phase)) return
    let { phase: savedPhase, exerciseIdx: savedEx, setIdx: savedSet } = pos
    // The 3 s breathe interstitial resumes on the exercise it leads to.
    if (savedPhase === 'breathe') {
      savedPhase = sessionType === 'foundation_run' ? 'fr-warmup' : 'exercise'
      savedEx += 1
      savedSet = 0
    }
    if (savedPhase === 'mark-earned' || savedPhase === 'combo-unlock') savedPhase = 'complete'
    saveResume(resumeStorage(), {
      sessionId: id,
      engine: engineForType(sessionType),
      phase: savedPhase,
      exerciseIdx: savedEx,
      setIdx: savedSet,
      roundIdx: pos.roundIdx,
      engineState: engineStateRef.current,
    }, Date.now())
  }, [id, sessionType])

  /** Engine views call this on every change of their own state. */
  // Per-round seconds (bag work, rope) for the done summary, kept on the phone until the finish.
  const recordRoundSec = useCallback((roundIndex: number, sec: number) => {
    if (!id) return
    const list = parseRoundSecs(storageGetItem(roundSecsKey(id))) ?? []
    storageSetItem(roundSecsKey(id), JSON.stringify(withRoundSec(list, roundIndex, sec)))
  }, [id])

  const persistEngine = useCallback((state: EngineState) => {
    engineStateRef.current = state
    writeResume()
  }, [writeResume])

  // The engine has taken its saved state; later mounts start fresh.
  useEffect(() => {
    if (!engineResume) return
    const t = setTimeout(() => setEngineResume(null), 0)
    return () => clearTimeout(t)
  }, [engineResume, phase, exerciseIdx, setIdx, roundIdx])

  /**
   * Back / x: leave the session. It stays in progress with everything saved;
   * Today shows it with Resume. Ending is a deliberate act (hold the x on
   * Today, then choose), never a plain tap here.
   */
  function leaveSession() {
    writeResume()
    try {
      sessionStorage.setItem('waymark_suppress_auto_resume_until', String(Date.now() + 2 * 60 * 1000))
    } catch {
      // sessionStorage can be unavailable in private contexts.
    }
    // Cues and the lock screen belong to the open session screen; resume
    // re-syncs both from the saved end times.
    void cancelAllCues()
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
  const strengthActivePlace = strengthActiveExercise ? setPlace(strengthActiveExercise.sets, setIdx) : null
  // Header count on the lock screen (STRENGTH · 2/5): the lift's place in the session.
  const strengthExerciseCount = strengthData?.exercises.length ?? 0
  const strengthStep = strengthExerciseCount > 0
    ? { stepIndex: exerciseIdx + 1, stepTotal: strengthExerciseCount }
    : {}

  // Pending weight/reps from the SetTracker inputs — pushed live so a
  // lock-screen "Complete Set" tap logs the same values the user sees.
  /** This session's last logged weight per lift (exerciseId -> kg). */
  const loggedKgRef = useRef(new Map<string, number>())
  const pendingSetValuesRef = useRef<{ weightKg: number | null; reps: number }>({
    weightKg: null,
    reps: 0,
  })
  const handleLiveValuesChange = useCallback((weightKg: number | null, reps: number) => {
    pendingSetValuesRef.current = { weightKg, reps }
  }, [])

  // The exercise card's timestamps are ignored by the widget; one stable
  // value keeps the payload from changing on every render.
  const [exerciseCardAtMs] = useState(() => Date.now())

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
          // Kept on the rest card too, so the lock screen never loses the lift.
          exerciseName: strengthActiveName,
          ...strengthStep,
          startedAt: restTimer.startedAtMs,
          endsAt: restTimer.endsAtMs,
          isPaused: restTimer.isPaused,
          pausedRemaining: restTimer.isPaused
            ? restTimer.secondsRemaining
            : undefined,
        },
      }
    } else if (phase === 'exercise' && strengthActiveTotalSets > 0) {
      strengthActivityConfig = {
        sessionType: 'strength',
        sessionLabel: 'Strength',
        state: {
          phase: 'exercise',
          label: `${strengthActivePlace?.warmup ? 'Warmup' : 'Set'} ${strengthActivePlace?.n ?? setIdx + 1} of ${strengthActivePlace?.of ?? strengthActiveTotalSets}`,
          detail: strengthActiveName,
          exerciseName: strengthActiveName,
          ...strengthStep,
          setIndex: strengthActivePlace?.n ?? setIdx + 1,
          setTotal: strengthActivePlace?.of ?? strengthActiveTotalSets,
          // Timer fields ignored by the widget in exercise phase, but the
          // payload shape requires them.
          startedAt: exerciseCardAtMs,
          endsAt: exerciseCardAtMs,
          isPaused: false,
        },
      }
    }
  }

  useSessionLiveActivity(strengthActivityConfig, {
    onPause: (pausedRemainingMs) => {
      void cancelStrengthRestEnd()
      restTimer.pause(pausedRemainingMs)
    },
    onResume: (newEndsAtMs) => {
      const endsAt = restTimer.resume(newEndsAtMs)
      if (endsAt > Date.now()) void scheduleStrengthRestEnd(endsAt)
    },
    onRestart: () => {
      if (!isStrengthSession || phase !== 'rest') return
      const currentSet = strengthData?.exercises[exerciseIdx]?.sets[setIdx]
      const restSec = currentSet?.restSec ?? 60
      void cancelStrengthRestEnd()
      restTimer.start(restSec)
      void scheduleStrengthRestEnd(Date.now() + restSec * 1000)
    },
    onEnd: () => {
      // Lock-screen End leaves the session (still in progress, resumable).
      leaveSession()
    },
    onCompleteSet: () => {
      if (phase !== 'exercise') return
      const prescribed = strengthData?.exercises[exerciseIdx]?.sets[setIdx]
      const { weightKg, reps } = pendingSetValuesRef.current
      const finalReps = reps > 0 ? reps : prescribed?.reps ?? 0
      if (finalReps <= 0) return
      const finalWeightKg =
        weightKg != null ? weightKg : prescribed?.weightKg ?? null
      // From the lock screen: no card to answer, so rest starts as before.
      handleSetComplete(finalWeightKg, finalReps, { fromLockScreen: true })
    },
    onAdvance: () => {
      // "Skip →" during rest — cut the rest short and move on.
      if (phase === 'rest') {
        void cancelStrengthRestEnd()
        handleNextSet()
      }
    },
  })

  useWakeLock(phase === 'rest' && restTimer.isRunning && !restTimer.isPaused)

  useEffect(() => {
    if (id) logger.setSessionId(id)
    return () => logger.setSessionId(undefined)
  }, [id])

  const restoreRest = restTimer.restore
  useEffect(() => {
    if (!id) return
    async function load() {
      try {
        const allSessions = await apiFetch<SessionData[]>('/api/sessions')
        const session = allSessions.find(s => s.id === id)
        if (!session) throw new Error('Session not found')

        setSessionType(session.type)
        setSessionLabel(session.label ?? null)
        // Runs carry no block week (the server only stamps strength), so the block's training week decides.
        if ((session.type === 'running' || session.type === 'foundation_run') && session.blockType === 'block_zero') {
          void (async () => {
            try {
              const block = await apiFetch<{ id: string; currentWeek?: number | null } | null>(`/api/blocks/current?date=${getTodayISO()}`)
              const week = session.blockWeek ?? block?.currentWeek ?? null
              if (!block?.id || week == null || !TALK_TEST_WEEKS.includes(week)) return
              const weekResults = await apiFetch<{ testKey: string; week: number }[]>(`/api/blocks/${block.id}/tests?week=${week}`)
              if (talkTestDue({ blockType: session.blockType, blockWeek: week, sessionType: session.type, runCategory: session.notes, weekResults: weekResults ?? [] })) {
                setTalkTest({ blockId: block.id, week })
              }
            } catch (e) {
              logger.warn('session', 'talk test check failed', { message: e instanceof Error ? e.message : String(e) }, 'Could not tell whether the talk test is due. Run log works without it.')
            }
          })()
        }
        setRunCategory(session.type === 'running' ? session.notes ?? null : null)
        const live = session.status !== 'completed' && session.status !== 'skipped'

        // Fetch the engine's rows (starting them if the session has none yet).
        let setCounts: number[] = []
        let rounds: RoundSpec[] | undefined
        let restAutoEnds = true
        let serverPosition: { phase: Phase; exerciseIdx: number; setIdx: number } = { phase: 'exercise', exerciseIdx: 0, setIdx: 0 }
        // The entrance's length line: the plan's own minutes, else the coach's planning minutes (as Today shows them).
        const showLength = (minutes: number | null | undefined, roundCount?: number | null) => setEntranceDetail(entranceLine({
          type: session.type,
          rounds: roundCount ?? null,
          week: session.blockWeek ?? null,
          minutes: minutes ?? estimatedMinutes({ type: session.type, notes: session.notes ?? null, estimatedMin: null }, session.blockType === 'block_zero' ? 'block_zero' : 'fighter', session.blockWeek ?? 1),
        }))

        if (session.type === 'foundation_run') {
          let data = await apiFetch<FoundationRunWorkoutData>(`/api/sessions/${id}/foundation-run-workout`)
          if (live && (!data.runSession || data.postureExercises.length === 0)) {
            data = await apiFetch<FoundationRunWorkoutData>(`/api/sessions/${id}/start-foundation-run`, { method: 'POST' })
          }
          setFoundationRunData(data)
          showLength((data.prescription?.targetDurSec ? data.prescription.targetDurSec / 60 : null))
          setCounts = data.postureExercises.map(e => Math.max(1, e.sets ?? 1))
          const next = deriveMobilityPosition(data.postureExercises)
          serverPosition = next === 'done'
            ? { phase: 'fr-run', exerciseIdx: 0, setIdx: 0 }
            : { phase: 'fr-warmup', exerciseIdx: next, setIdx: 0 }
        } else if (session.type === 'mobility') {
          let data = await apiFetch<MobilityWorkoutData>(`/api/sessions/${id}/mobility-workout`)
          if (live && data.exercises.length === 0) {
            data = await apiFetch<MobilityWorkoutData>(`/api/sessions/${id}/start-mobility`, { method: 'POST' })
          }
          setMobilityData(data)
          showLength(data.plannedMin)
          setCounts = data.exercises.map(e => Math.max(1, e.sets ?? 1))
          const next = deriveMobilityPosition(data.exercises)
          serverPosition = next === 'done'
            ? { phase: 'complete', exerciseIdx: Math.max(0, data.exercises.length - 1), setIdx: 0 }
            : { phase: 'exercise', exerciseIdx: next, setIdx: 0 }
        } else if (session.type === 'bag_work') {
          let data = await apiFetch<BagWorkoutData>(`/api/sessions/${id}/bag-workout`)
          if (live && data.rounds.length === 0) {
            data = await apiFetch<BagWorkoutData>(`/api/sessions/${id}/start-bag-work`, { method: 'POST' })
          }
          setBagData(data)
          showLength(data.plannedMin, data.rounds.length)
          rounds = data.rounds.map(r => ({ durationSec: r.durationSec, restSec: r.restSec }))
        } else if (session.type === 'running') {
          let data = await apiFetch<RunWorkoutData>(`/api/sessions/${id}/run-workout`)
          if (live && !data.runSession) {
            data = await apiFetch<RunWorkoutData>(`/api/sessions/${id}/start-run`, { method: 'POST' })
          }
          setRunData(data)
          showLength((data.prescription?.targetDurSec ? data.prescription.targetDurSec / 60 : null))
        } else if (session.type === 'skip_rope') {
          let data = await apiFetch<SkipWorkoutData>(`/api/sessions/${id}/skip-rope-workout`)
          if (live && !data.skipSession) {
            data = await apiFetch<SkipWorkoutData>(`/api/sessions/${id}/start-skip-rope`, { method: 'POST' })
          }
          setSkipData(data)
          showLength(data.plannedMin, data.skipSession?.roundCount ?? null)
          if (data.skipSession) {
            rounds = Array.from({ length: data.skipSession.roundCount }, () => ({ durationSec: data.skipSession!.roundDurSec, restSec: SKIP_REST_SEC }))
            restAutoEnds = false
          }
        } else if (session.type === 'active_recovery') {
          let data = await apiFetch<RecoveryWorkoutData>(`/api/sessions/${id}/recovery-workout`)
          if (live && !data.recoverySession) {
            data = await apiFetch<RecoveryWorkoutData>(`/api/sessions/${id}/start-recovery`, { method: 'POST' })
          }
          setRecoveryData(data)
          showLength(null)
        } else if (session.type === 'mt_class') {
          let data = await apiFetch<MtClassWorkoutData>(`/api/sessions/${id}/mt-class-workout`)
          if (live && !data.mtLog) {
            data = await apiFetch<MtClassWorkoutData>(`/api/sessions/${id}/start-mt-class`, { method: 'POST' })
          }
          setMtData(data)
          showLength(data.plannedMin)
        } else {
          const data = await apiFetch<StrengthWorkoutData>(`/api/sessions/${id}/workout`)
          setStrengthData(data)
          showLength(data.plannedMin)
          setCounts = data.exercises.map(e => e.sets.length)
          const next = deriveStrengthPosition(data.exercises, locallyLoggedSetIds(id!))
          serverPosition = next === 'done'
            ? { phase: 'complete', exerciseIdx: Math.max(0, data.exercises.length - 1), setIdx: 0 }
            : { phase: 'exercise', ...next }

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

        if (session.status !== 'in_progress') {
          // Not started (or already closed): no resume. Clear any leftover save.
          if (!live) clearResume(resumeStorage(), id!)
          return
        }

        const saved = loadResume(resumeStorage(), id!)
        if (saved && saved.engine === engineForType(session.type)) {
          const restore = () => applyResume(session.type, saved, { rounds, restAutoEnds, setCounts })
          if (resumeDecision(saved, Date.now()) === 'ask') {
            setStaleResume(saved)
            pendingRestoreRef.current = restore
          } else {
            restore()
          }
          return
        }

        // No save on this phone (another device, cleared storage): pick up
        // from what the server knows. Strength: the first unlogged set.
        // Foundation: the first exercise not marked done.
        setExerciseIdx(serverPosition.exerciseIdx)
        setSetIdx(serverPosition.setIdx)
        setRoundIdx(0)
        setPhase(serverPosition.phase)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        console.error('Failed to load workout:', e)
        logger.error('session', 'workout load failed', { sessionId: id, message }, 'GET /sessions/:id failed or 404. Workout screen has no data.')
        showToast("Couldn't load workout. Check logs in Settings.", 'warning')
      } finally {
        armedRef.current = true
        setLoading(false)
      }
    }

    /** Bring the save up to now (elapsed phases advance) and put it back. */
    function applyResume(type: string, saved: SessionResumeState, ctx: { rounds?: RoundSpec[]; restAutoEnds: boolean; setCounts: number[] }) {
      const now = Date.now()
      const rollSecs = type === 'active_recovery' ? rollStepSecs() : undefined
      const { state, completed } = restoreForNow(saved, now, { rounds: ctx.rounds, restAutoEnds: ctx.restAutoEnds, setCounts: ctx.setCounts, rollSecs })
      let nextPhase = normalizePhase(type, state.phase)
      let ex = state.exerciseIdx
      let set = state.setIdx
      if (type === 'strength' || engineForType(type) === 'strength') {
        // Clamp to the workout as it is now; never an "expired" dead end.
        const pos = clampStrengthPosition({ exerciseIdx: ex, setIdx: set }, ctx.setCounts)
        ex = pos.exerciseIdx
        set = pos.setIdx
      } else if (ctx.setCounts.length > 0) {
        ex = Math.min(Math.max(0, ex), ctx.setCounts.length - 1)
        set = Math.min(Math.max(0, set), (ctx.setCounts[ex] ?? 1) - 1)
      }
      const es = state.engineState
      if (completed) {
        nextPhase = type === 'bag_work' ? 'combo-rating' : 'complete'
      }
      if (es?.kind === 'strength' && nextPhase === 'rest' && es.restTimer) {
        restoreRest(es.restTimer)
        if (es.restTimer.state === 'running') void scheduleStrengthRestEnd(es.restTimer.endsAtMs)
        else void cancelStrengthRestEnd()
      } else if (nextPhase === 'rest') {
        // A rest with no saved timer: back to the set card.
        nextPhase = 'exercise'
      }
      if (es?.kind === 'rounds' && !completed) setRoundPhase(es.sub)
      setExerciseIdx(ex)
      setSetIdx(set)
      setRoundIdx(state.roundIdx)
      engineStateRef.current = es
      setEngineResume(es)
      setPhase(nextPhase)
      logger.sessionEvent('session resumed', { sessionId: saved.sessionId, phase: nextPhase, ageMs: now - saved.savedAt })
    }

    load()
  }, [id, showToast, restoreRest])

  // Auto-save workout progress on every step (position; engine views add theirs).
  const restSnapshot = restTimer.snapshot
  useEffect(() => {
    posRef.current = { phase, exerciseIdx, setIdx, roundIdx }
    if (sessionType && engineForType(sessionType) === 'strength' && (phase === 'exercise' || phase === 'rest')) {
      engineStateRef.current = { kind: 'strength', restTimer: phase === 'rest' ? restSnapshot() : null }
    }
    writeResume()
  }, [writeResume, sessionType, phase, exerciseIdx, setIdx, roundIdx, restSnapshot, restTimer.isRunning, restTimer.isPaused, restTimer.endsAtMs])

  // Strength rest ran out (also after a lock or a reload: <= 0 catches a jump past zero).
  useEffect(() => {
    if (phase !== 'rest' || !restTimer.isRunning || restTimer.isPaused || restTimer.secondsRemaining > 0 || !strengthData) return

    // The in-app "next set" cue (the lock-screen one is silent in the foreground).
    if (!isStaleCue(restTimer.endsAtMs, Date.now())) soundRoundStart()
    restTimer.stop()
    void cancelStrengthRestEnd()

    const next = nextStrengthPosition({ exerciseIdx, setIdx }, strengthData.exercises.map(e => e.sets.length))
    if (next === 'done') {
      setPhase('mark-earned')
    } else {
      setExerciseIdx(next.exerciseIdx)
      setSetIdx(next.setIdx)
      setPhase('exercise')
    }
  }, [phase, restTimer, restTimer.isRunning, restTimer.isPaused, restTimer.secondsRemaining, strengthData, exerciseIdx, setIdx])

  const handleEntranceComplete = useCallback(() => {
    // page 17: the session's first screen cascades in as the entrance lifts
    armCascade()
    if (sessionType === 'bag_work') {
      setPhase('bag-preview')
    } else if (sessionType === 'foundation_run') {
      // The Zone 2 engine has no 'exercise' phase: it rendered blank here.
      setPhase('fr-warmup')
    } else if (strengthData) {
      setPhase('strength-warmup-skip')
    } else {
      setPhase('exercise')
    }
  }, [sessionType, strengthData])

  // The old pre-close mark overlay is gone: the close is effort first, then the moment (page 19 #6).
  useEffect(() => {
    if (phase === 'mark-earned') setPhase('complete')
  }, [phase])

  async function handleFinish(rpe: number, notes: string) {
    if (!id) return
    setSubmitting(true)
    logger.sessionEvent('session finish attempt', { sessionId: id, rpe, hasNotes: notes.length > 0 })
    try {
      // Queued set saves go first, then the finish, in order. The finish has
      // one key per tap of Finish, and the server finishes a session once.
      await flushOutbox({ force: true, onlySessionId: id })
      const roundSecs = sessionType === 'bag_work' || sessionType === 'skip_rope' ? parseRoundSecs(storageGetItem(roundSecsKey(id))) : null
      const result = await queueWrite({
        method: 'POST',
        path: `/api/sessions/${id}/complete`,
        body: { rpe, notes, completedAt: Math.floor(Date.now() / 1000), ...(roundSecs ? { roundSecs } : {}) },
        sessionId: id,
        kind: 'finish',
        key: finishKeyRef.current,
      })
      if (result === 'rejected') throw new Error('finish refused by the server')
      if (result === 'queued') {
        const pending = pendingWrites(id)
        logger.warn('session', 'session finish queued', { sessionId: id, pending }, 'Finish kept on this phone, retrying.')
        showToast("No connection. Session saved on this phone. It syncs when you're back online.", 'warning')
      }
      logger.sessionEvent('session finish ok', { sessionId: id, queued: result === 'queued' })
      armedRef.current = false
      clearResume(resumeStorage(), id)
      storageRemoveItem(roundSecsKey(id))
      void cancelAllCues()
      // Let the Live Activity show its finish card for 4s before it dismisses
      // itself from the lock screen. Its one line names what the coach moved
      // around tonight's session (page 56 item 12), in the existing detail field.
      void coachLine('finish').then(line => {
        const now = Date.now()
        return endLiveActivity(
          {
            phase: 'complete',
            label: 'Session Complete',
            startedAt: now,
            endsAt: now,
            isPaused: false,
            completeMessage: line ?? 'Session complete',
            ...(line ? { detail: line } : {}),
          },
          4000,
        )
      })
      setMoment(momentLine(sessionLabel ?? SESSION_ICON_NAME[sessionIconFor(sessionType ?? 'strength', runCategory)], rpe))
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.error('Failed to complete session:', e)
      logger.error('session', 'session finish failed', { sessionId: id, message }, 'POST /sessions/:id/complete failed. Session state stuck in-progress.')
      showToast("Couldn't save. Check connection and try again.", 'warning')
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

  // ─── Old save: resume or end (never silently dropped) ─────

  if (staleResume) {
    const savedAt = new Date(staleResume.savedAt)
    const when = savedAt.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center gap-4 bg-near-black px-6 text-center">
        <SessionBackground />
        <p className="relative z-10 font-cinzel text-xl tracking-wider text-foreground">Session in progress</p>
        <p className="relative z-10 max-w-xs text-sm text-muted-foreground">
          Last saved {when}. Pick up where you left off, or end it and log what you did.
        </p>
        <div className="relative z-10 flex w-full max-w-xs flex-col gap-2">
          <Button
            size="lg"
            onClick={() => {
              const restore = pendingRestoreRef.current
              pendingRestoreRef.current = null
              setStaleResume(null)
              restore?.()
            }}
          >
            Resume
          </Button>
          <Button
            size="lg"
            variant="secondary"
            onClick={() => {
              pendingRestoreRef.current = null
              setStaleResume(null)
              setPhase('complete')
            }}
          >
            End and Log
          </Button>
        </div>
        <ToastContainer />
      </div>
    )
  }

  // ─── The moment (page 19 #6): after the close is saved ────

  if (moment) {
    return <SessionMoment line={moment} onDone={() => navigate('/today', { replace: true })} />
  }

  // ─── Entrance animation ───────────────────────────────────

  if (phase === 'entrance' && sessionType) {
    return (
      <RitualEntrance
        sessionType={sessionType}
        runCategory={runCategory}
        detail={entranceDetail}
        onComplete={handleEntranceComplete}
      />
    )
  }

  // ─── Breathing cue interstitial (Foundation; page 31 "Breathe") ───

  if (phase === 'breathe') return <BreatheScreen />

  // ─── Closing: effort (page 19 #6), the same for every session ───

  const closing = phase === 'complete' || phase === 'mark-earned'
  const closeScreen = (
    <>
      <SessionComplete sessionType={sessionType ?? 'strength'} onFinish={handleFinish} submitting={submitting} />
      <ToastContainer />
    </>
  )

  // ─── Zone 2 (dynamic warmup → easy run) ────────────────────

  if (sessionType === 'foundation_run' && foundationRunData) {
    if (closing) return closeScreen
    const frExercises = foundationRunData.postureExercises
    const frTotalExercises = frExercises.length
    const frCurrentExercise = frExercises[exerciseIdx]
    const frTotalSets = frCurrentExercise?.sets ?? 1

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

    if (phase === 'fr-warmup' && frCurrentExercise) {
      return (
        <MobilityExerciseView
          key={`fr-${exerciseIdx}-${setIdx}`}
          inline
          title="ZONE 2"
          exercise={frCurrentExercise}
          exerciseIndex={exerciseIdx}
          totalExercises={frTotalExercises}
          currentSet={setIdx + 1}
          onSetDone={handleFrWarmupSetDone}
          onExit={leaveSession}
          resume={engineResume?.kind === 'hold' ? engineResume : null}
          onPersist={persistEngine}
        />
      )
    }
    if (phase === 'fr-run' && foundationRunData.runSession) {
      return (
        <RunSessionView
          runSession={foundationRunData.runSession}
          prescription={foundationRunData.prescription}
          onComplete={() => setPhase('mark-earned')}
          onExit={leaveSession}
          resume={engineResume?.kind === 'run' ? engineResume : null}
          onPersist={persistEngine}
          talkTest={talkTest}
        />
      )
    }
    // No warm-up rows (straight to the run) or a run that isn't ready: no mockup, a plain frame.
    return (
      <SessionFrame title="ZONE 2" icon="zone2" onEnd={leaveSession}>
        <div className="tm-wide" style={{ marginTop: 40 }}>
          {foundationRunData.runSession
            ? <SessionButton label="START RUN" primary onClick={() => setPhase('fr-run')} />
            : <p className="wm-prose is-dim tm-center">Run not ready. Go back and enter again.</p>}
        </div>
      </SessionFrame>
    )
  }

  // ─── Mobility workout ──────────────────────────────────────

  if (sessionType === 'mobility' && mobilityData) {
    if (closing) return closeScreen
    const exercises = mobilityData.exercises
    const totalExercises = exercises.length
    const currentExercise = exercises[exerciseIdx]
    const totalSets = currentExercise?.sets ?? 1

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

    if (!currentExercise) return null

    return (
      <MobilityExerciseView
        key={`${exerciseIdx}-${setIdx}`}
        exercise={currentExercise}
        exerciseIndex={exerciseIdx}
        totalExercises={totalExercises}
        currentSet={setIdx + 1}
        onSetDone={handleMobilitySetDone}
        onExit={leaveSession}
        resume={engineResume?.kind === 'hold' ? engineResume : null}
        onPersist={persistEngine}
      />
    )
  }

  // ─── MT class workout ───────────────────────────────────────
  // MtClassLogView is the page-31 board over the forest. WorkoutPage handles only complete.

  if (sessionType === 'mt_class' && mtData?.mtLog) {
    if (closing) return closeScreen
    return (
      <>
        <MtClassLogView
          mtLog={mtData.mtLog}
          plannedMin={mtData.plannedMin ?? null}
          blockType={mtData.session.blockType ?? null}
          onComplete={() => setPhase('mark-earned')}
          onExit={leaveSession}
          resume={engineResume?.kind === 'mt' ? engineResume : null}
          onPersist={persistEngine}
        />
        <ToastContainer />
      </>
    )
  }

  // ─── Running workout ────────────────────────────────────────

  if (sessionType === 'running' && runData?.runSession) {
    if (closing) return closeScreen
    return (
      <>
        <RunSessionView
          runSession={runData.runSession}
          prescription={runData.prescription}
          onComplete={() => setPhase('mark-earned')}
          onExit={leaveSession}
          resume={engineResume?.kind === 'run' ? engineResume : null}
          onPersist={persistEngine}
          talkTest={talkTest}
        />
        <ToastContainer />
      </>
    )
  }

  // ─── Skip rope workout ──────────────────────────────────────

  if (sessionType === 'skip_rope' && skipData?.skipSession) {
    if (closing) return closeScreen
    return (
      <>
        <SkipRopeView
          skipSession={skipData.skipSession}
          onComplete={() => setPhase('mark-earned')}
          onExit={leaveSession}
          resume={engineResume?.kind === 'rounds' ? engineResume : null}
          onPersist={persistEngine}
          onRoundDone={recordRoundSec}
        />
        <ToastContainer />
      </>
    )
  }

  // ─── Active recovery workout ───────────────────────────────
  // ActiveRecoveryView (Reset) has no approved in-session mockup yet: unchanged.

  if (sessionType === 'active_recovery' && recoveryData?.recoverySession) {
    if (closing) return closeScreen
    return (
      <>
        <ActiveRecoveryView
          recoverySession={recoveryData.recoverySession}
          onComplete={() => setPhase('mark-earned')}
          onExit={leaveSession}
          resume={engineResume?.kind === 'recovery' ? engineResume : null}
          onPersist={persistEngine}
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

    // Preview phase: one centred board of the rounds before starting (page 31)
    if (phase === 'bag-preview') {
      return (
        <>
          <BagPreviewCard rounds={rounds} onBegin={() => setPhase('bag-warmup')} onBack={leaveSession} />
          <ToastContainer />
        </>
      )
    }

    // Skip rope warmup before bag rounds
    if (phase === 'bag-warmup') {
      return (
        <SkipWarmupTimer
          durationSec={300}
          onComplete={() => setPhase('exercise')}
          description="Light and easy. Get the blood flowing before you hit the bag."
          resume={engineResume?.kind === 'warmup' ? engineResume.timer : null}
          onPersist={persistEngine}
          onExit={leaveSession}
        />
      )
    }

    // Combo rating phase: one card at a time
    if (phase === 'combo-rating') {
      return (
        <ComboRatingScreen
          sessionId={id!}
          combos={allCombosForRating}
          onComplete={handleRatingComplete}
        />
      )
    }

    // Combo unlock suggestion phase
    if (phase === 'combo-unlock' && unlockSuggestions) {
      return (
        <ComboUnlockSuggestion
          suggestions={unlockSuggestions.suggestions}
          message={unlockSuggestions.message}
          onDone={() => setPhase('mark-earned')}
        />
      )
    }

    if (closing) return closeScreen

    return currentRound ? (
      <>
        <BagWorkRoundView
          key={roundIdx}
          round={currentRound}
          totalRounds={totalRounds}
          nextRound={rounds[roundIdx + 1] ?? null}
          rounds={rounds}
          phase={roundPhase}
          onPhaseChange={setRoundPhase}
          onNextRound={() => {
            setRoundIdx(roundIdx + 1)
            setRoundPhase('ready')
          }}
          onComplete={handleBagWorkComplete}
          onExit={leaveSession}
          onRoundDone={recordRoundSec}
          resume={engineResume?.kind === 'rounds' ? engineResume : null}
          onPersist={persistEngine}
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

  const strengthTitle = (sessionLabel ?? 'Strength').toUpperCase()

  // Skip rope warmup before strength exercises
  if (phase === 'strength-warmup-skip') {
    return (
      <SkipWarmupTimer
        durationSec={180}
        onComplete={() => setPhase('exercise')}
        description="Light and easy. Loosen up before you lift."
        resume={engineResume?.kind === 'warmup' ? engineResume.timer : null}
        onPersist={persistEngine}
        onExit={leaveSession}
      />
    )
  }

  const currentExercise = strengthData.exercises[exerciseIdx]

  if (!currentExercise) {
    // A saved position past the end of the workout (rows changed since).
    // Resume clamps positions on load, so this is only a workout with no
    // exercises at all: offer the close instead of a dead end.
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-near-black px-6 text-center">
        <p className="text-sm text-muted-foreground">No exercises left in this workout.</p>
        <Button size="lg" onClick={() => setPhase('complete')}>
          Finish Session
        </Button>
        <button
          onClick={leaveSession}
          className="min-h-[44px] px-3 text-sm text-muted-foreground active:text-foreground"
        >
          Back to Today
        </button>
      </div>
    )
  }
  const currentSet = currentExercise?.sets[setIdx]
  // Warm-ups and working sets count apart ("Warmup 1 of 1", then "Set 1 of 2").
  const place = currentExercise ? setPlace(currentExercise.sets, setIdx) : null
  const totalSetsForExercise = place?.of ?? 0

  function handleSetComplete(weightKg: number | null, reps: number, opts: { fromLockScreen?: boolean } = {}) {
    if (!currentSet) return

    // Outbox first: the set is kept on this phone until the server has it, and
    // retries on reconnect, foreground and before finishing. One key per log,
    // so a retry never writes it twice.
    const setId = currentSet.id
    const completedAt = Math.floor(Date.now() / 1000)
    // The next set of this lift starts from what was just lifted (a work-up with no planned load).
    if (currentExercise && weightKg != null && weightKg > 0) loggedKgRef.current.set(currentExercise.exerciseId, weightKg)
    void queueWrite({
      method: 'PATCH',
      path: `/api/strength-sets/${setId}`,
      body: { weightKg, reps, completedAt },
      sessionId: id ?? null,
      kind: 'set',
      key: `set-${setId}-${completedAt}`,
    }).then(result => {
      if (result === 'sent') return
      logger.warn('session', 'strength set queued', { setId, result }, result === 'queued' ? 'Set save failed. Kept on this phone, retrying.' : 'Server refused the set save.')
      showToast(result === 'queued'
        ? "No connection. Set saved on this phone. It syncs when you're back online."
        : "Set didn't save. The server refused it. Check logs in Settings.", 'warning')
    })

    // Working sets ask how many reps were left (3+ / 2 / 1 / 0); one tap, then rest.
    if (!opts.fromLockScreen && asksEffort({ isWarmup: currentSet.isWarmup, reps, section: currentExercise?.section ?? null })) {
      setEffortFor({ setId, label: `Set ${place?.n ?? setIdx + 1} of ${totalSetsForExercise}` })
      return
    }
    startStrengthRest()
  }

  function startStrengthRest() {
    const restSec = currentSet?.restSec ?? 60
    restTimer.start(restSec)
    void scheduleStrengthRestEnd(Date.now() + restSec * 1000)
    setPhase('rest')
  }

  function handleEffortPick(rir: number | null) {
    const target = effortFor
    setEffortFor(null)
    if (target && rir != null) {
      // Its own outbox write after the set's: ordered per session, keyed so a retry never doubles it.
      void queueWrite(effortWrite(target.setId, rir, id ?? null)).then(result => {
        if (result === 'rejected') logger.warn('session', 'set effort refused', { setId: target.setId, rir }, 'Server refused the RIR save.')
      })
    }
    startStrengthRest()
  }

  function handleNextSet() {
    restTimer.stop()
    void cancelStrengthRestEnd()

    const next = nextStrengthPosition({ exerciseIdx, setIdx }, strengthData!.exercises.map(e => e.sets.length))
    if (next === 'done') {
      setPhase('mark-earned')
    } else {
      setExerciseIdx(next.exerciseIdx)
      setSetIdx(next.setIdx)
      setPhase('exercise')
    }
  }

  if (closing) return closeScreen

  const sectionKey = (currentExercise?.section ?? null) as StrengthSection | null

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
        sessionTitle={strengthTitle}
        exerciseName={currentExercise.exercise?.name ?? ''}
        formCues={currentExercise.exercise?.formCues ?? null}
        equipment={currentExercise.exercise?.equipment ?? null}
        notes={currentExercise.notes}
        formVideoUrl={currentExercise.exercise?.formVideoUrl}
        section={sectionKey}
        currentSet={currentSet ? {
          setNumber: place?.n ?? currentSet.setNumber,
          totalSets: totalSetsForExercise,
          isWarmup: currentSet.isWarmup === 1,
          suggestedWeightKg: currentSet.weightKg,
          carryWeightKg: currentExercise ? (loggedKgRef.current.get(currentExercise.exerciseId)
            ?? currentExercise.sets.slice(0, setIdx).reverse().find(s => s.weightKg != null && s.weightKg > 0)?.weightKg
            ?? exerciseHistories.get(currentExercise.exerciseId)?.lastSession?.weightKg
            ?? null) : null,
          targetReps: currentSet.plannedReps ?? currentSet.reps,
          restSec: currentSet.restSec ?? 60,
        } : undefined}
        lastSessionData={lastSessionData}
        suggestion={suggestionDisplay}
        restState={phase === 'rest' ? {
          totalSeconds: currentSet?.restSec ?? 60,
          secondsRemaining: restTimer.secondsRemaining,
          isOvertime: restTimer.isOvertime,
          isPaused: restTimer.isPaused,
          endsAtMs: restTimer.endsAtMs,
          onTogglePause: () => {
            if (restTimer.isPaused) {
              const endsAt = restTimer.resume()
              if (endsAt > Date.now()) void scheduleStrengthRestEnd(endsAt)
            } else {
              void cancelStrengthRestEnd()
              restTimer.pause()
            }
          },
        } : undefined}
        onSetComplete={handleSetComplete}
        onLiveValuesChange={handleLiveValuesChange}
        onNextSet={handleNextSet}
        onExit={leaveSession}
      />
      {effortFor && phase === 'exercise' && (
        <EffortCard setLabel={effortFor.label} onPick={rir => handleEffortPick(rir)} onSkip={() => handleEffortPick(null)} />
      )}
      <ToastContainer />
    </>
  )
}
