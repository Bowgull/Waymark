import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { CentredCard, FlapLabel, SessionIcon } from '@/design'
import { CountRow, GrassZone, HeroClock, NextLine, PhaseWord, SessionButton, SessionFrame, sentenceCase, shortTime, TimerColumn, useEaseAway, type TimerTrack } from '@/components/timers'
import { HeartContainer } from '@/components/heart/HeartContainer'
import { useToast } from '@/components/ui/Toast'
import { EARLY_END_REASONS } from '@/components/ui/departures'
import { ReasonTiles } from '@/features/coach/ReasonTiles'
import { apiFetch } from '@/lib/api'
import { logger } from '@/lib/logger'
import { soundRoundEnd, soundRoundStart } from '@/lib/sounds'
import { mediumHaptic, tapHaptic } from '@/lib/haptics'
import { newIdempotencyKey } from '@/lib/api'
import { keepForRetry, runLogWrite } from '@/lib/logWrites'
import { pendingWrites, queueWrite, type QueueResult } from '@/lib/outboxSync'
import { enteredOver, heartState, nextZone, ZONE_START, type HrZone, type ZoneTracker } from '@/lib/hrZoneState'
import { runRecorder, type StrapLink } from '@/lib/runRecorder'
import { summarizeRecording, type RunRecording } from '@/lib/runRecording'
import { uploadRecording } from '@/lib/runRecordingUpload'
import { cancelRunWalkCues, scheduleRunWalkCues } from '@/lib/notifications'
import { movePlan, planOnRunClock, runWalkAt, runWalkCueTimes, runWalkSegments, runWalkWord, type PlanMove, type RunWalkShape } from '@/lib/timers/runWalk'
import { assessRunCompletion, shouldShowRunRealityMark } from '@/lib/trainingReality'
import { parseDurationToSec } from '@/lib/duration'
import { NARUTO_NETFLIX_URL, ONEPACE_URL, type IndoorMedia } from '@/lib/onePace'
import { NARUTO_EPISODES, narutoArcForEp, narutoEpisodesWatched, narutoNextEp } from '@/lib/naruto'
import { getItem as storageGet, setItem as storageSet } from '@/lib/safeStorage'
import {
  stopwatchElapsedMs,
  stopwatchPause,
  stopwatchResume,
  type EngineState,
  type StopwatchSnap,
} from '@/lib/sessionResume'
import { clampTalkHr, talkTestStart, talkTestToSave, TALK_TEST_RANGE } from '@/lib/blockZero/talkTest'
import { backStep, heatFor, workLabel } from '@/lib/timers/timerLook'
import { useWakeLock } from '@/lib/wakeLock'
import { setWorldBackdrop } from '@/world/worldStore'

import '@/design/pickers.css'
import './session.css'
import { hardRunGlow, runWalkGlow, zone2Glow } from '@/lib/lockGlow'
import { pieceTimes, type RecorderPiece, type RunPiece } from '@/lib/runPieceActivity'
import { useSessionLiveActivity, type LiveActivityConfig } from './useSessionLiveActivity'
import { NarutoEpisodeCard } from './NarutoEpisodeCard'
import { checkMaxHrBump } from '@/lib/maxHrBump'
import { parseFiveK, type HardPlan } from '@/lib/brain/hardRuns'
import { hardAt, hardCues, hardSegments, nextWords, nudgeTargets, nudgeWord, phaseTone, phaseWord, type HardSegment } from '@/lib/runCues'
import { altMph, BASE_INCLINE, mmss, paceFlap, paceUnitWord, speedFlap, speedUnitWord, type TreadmillUnit } from '@/lib/runSpeed'
import { useTreadmillUnit } from '@/lib/treadmillUnit'
import { postRunShort, type PostRunFacts } from '@/lib/postRun'

interface RunSession {
  id: string
  sessionId?: string
  runType: string | null
  distanceKm: number | null
  durationSec: number | null
  plannedDurationSec?: number | null
  completionRatio?: number | null
  completionStatus?: string | null
  isIndoor: number
  onePaceArc: string | null
  onePaceEp: string | null
  avgHr?: number | null
  maxHr?: number | null
}

interface RunPrescription {
  weekNumber: number
  runType: string
  targetDesc: string
  targetDurSec: number | null
  targetDistKm: number | null
  z2CeilingBpm?: number | null
  /** Block Zero run-walk: warm-up walk, then rounds of run / walk (the server's shape). */
  runWalk?: RunWalkShape | null
  /** An easy walk or bike in the run's place (a rough morning, an injury): no running at all. */
  walkOnly?: boolean
  /** The run's one name from its dose ("Zone 2 Run", "Run-Walk", "Easy Walk or Bike", "Tempo", "Intervals", "5K Test"), as on its row. */
  name?: string | null
  /** Page 76: a hard run (tempo, intervals, the 5K test): its pieces, speeds and heart range. */
  hard?: HardPlan | null
}

type RunPhase = 'ready' | 'running' | 'logging'
type RunState = Extract<EngineState, { kind: 'run' }>

const INDOOR_MEDIA_KEY = 'waymark_indoor_media'

function storedIndoorMedia(): IndoorMedia {
  return storageGet(INDOOR_MEDIA_KEY) === 'naruto' ? 'naruto' : 'one_pace'
}

const WALK_ONLY_NAME = 'Easy Walk or Bike'
/** How long the saved board shows its line before it goes on by itself (page 76 §4b). */
const SAVED_MS = 2600

/** The dose is an easy walk or bike, no running (the server's walkOnly, or a run-walk of 0 rounds). */
function isWalkOnly(p: RunPrescription | null | undefined): boolean {
  return !!p && (p.walkOnly === true || (p.runWalk != null && !(p.runWalk.rounds > 0)))
}

// Page 93: four run names only (Zone 2 Run, Tempo, Intervals, Run-Walk), and the 5K test.
const RUN_TYPE_LABELS: Record<string, string> = {
  zone2: 'Zone 2 Run',
  easy: 'Zone 2 Run',
  tempo: 'Tempo',
  intervals: 'Intervals',
  '5k_test': '5K Test',
}

/** The run on the session flap (page 19: ZONE 2 · RUN). */
const RUN_TITLES: Record<string, string> = {
  zone2: 'ZONE 2 RUN',
  easy: 'ZONE 2 RUN',
  easy_strides: 'ZONE 2 RUN + STRIDES',
  tempo: 'TEMPO',
  intervals: 'INTERVALS',
  '5k_test': '5K TEST',
}


interface RunSessionViewProps {
  runSession: RunSession
  prescription?: RunPrescription | null
  onComplete: () => void
  onExit?: () => void
  /**
   * When true, render body + inline footer only (no SessionShell wrapper).
   * Used by Foundation Run which provides its own outer frame.
   */
  inline?: boolean
  /** Saved phase, clock and log draft (session resume). */
  resume?: RunState | null
  /** Called on every change so the session can be resumed exactly here. */
  onPersist?: (state: RunState) => void
  /** Block Zero week 1 / 6, the week's first easy run-walk: Log your run asks the talk-test HR (page 45 #3). */
  talkTest?: { blockId: string; week: number } | null
}

export function RunSessionView({
  runSession,
  prescription,
  onComplete,
  onExit,
  resume,
  onPersist,
  talkTest,
}: RunSessionViewProps) {
  const draft = resume?.draft ?? {}
  const [phase, setPhase] = useState<RunPhase>(() => resume?.sub ?? 'ready')
  const [isIndoor, setIsIndoor] = useState(() => resume ? resume.isIndoor : runSession.isIndoor === 1)
  // Page 76: a hard run, and the treadmill unit every speed and pace follows.
  const hard = prescription?.hard ?? null
  const unit = useTreadmillUnit()
  // The 5K test: its time for Log your run (the GPS's 5.00 km outside, else the clock less the warm-up).
  const [fiveK, setFiveK] = useState(draft.fiveK ?? '')
  // A pace nudge on the screen for a few seconds (outside, hard pieces; the recorder plays its sound).
  const [nudge, setNudge] = useState<{ n: 'fast' | 'slow'; kmh: number; at: number } | null>(null)
  // After SAVE RUN (page 76 §4b): the board shows SAVED and the one line, then goes on by itself.
  const [saved, setSaved] = useState<{ line: string } | null>(null)
  const afterSave = useRef<(() => void) | null>(null)
  const [media, setMedia] = useState<IndoorMedia>(() => resume?.media ?? storedIndoorMedia())
  // The run clock: wall-clock anchored (virtual start time, or elapsed when
  // paused), so a lock, a reload or a kill keeps the right time.
  const [stopwatch, setStopwatch] = useState<StopwatchSnap | null>(() => resume?.stopwatch ?? null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const runPaused = stopwatch?.state === 'paused'
  const elapsed = stopwatch ? Math.floor(stopwatchElapsedMs(stopwatch, nowMs) / 1000) : 0
  const runStartedAtMs = !stopwatch ? 0 : stopwatch.state === 'running' ? stopwatch.startedAtMs : nowMs - stopwatch.elapsedMs
  // Page 85: a swipe moves the plan, never the run clock (lib/timers/runWalk movePlan). The plan's
  // clock is the run clock plus planShift; planMoves counts the swipes so the lock card flashes at each.
  const [planShift, setPlanShift] = useState(() => Number(draft.planShift) || 0)
  const [planMoves, setPlanMoves] = useState(() => Number(draft.planMoves) || 0)
  const lastBackAt = useRef<number | null>(null)

  const [distance, setDistance] = useState(draft.distance ?? '')
  const [duration, setDuration] = useState(draft.duration ?? '')
  const [avgHr, setAvgHr] = useState(draft.avgHr ?? '')
  const [maxHr, setMaxHr] = useState(draft.maxHr ?? '')
  const [onePaceArc, setOnePaceArc] = useState(draft.onePaceArc ?? runSession.onePaceArc ?? '')
  const [onePaceEp, setOnePaceEp] = useState(draft.onePaceEp ?? runSession.onePaceEp ?? '')
  const [saving, setSaving] = useState(false)
  const [endReason, setEndReason] = useState<string | null>(null)
  const [talkHr, setTalkHr] = useState(() => draft.talkHr ? clampTalkHr(Number(draft.talkHr)) : talkTestStart(Number(draft.avgHr ?? runSession.avgHr ?? NaN)))
  // The talk test is saved only once he sets the drum himself (audit #1); untouched, nothing is saved.
  const [talkTouched, setTalkTouched] = useState(() => !!draft.talkHr)
  const stepTalkHr = (delta: number) => { setTalkTouched(true); setTalkHr(v => clampTalkHr(v + delta)) }
  // Naruto: the saved next episode (settings), and the after-run confirm.
  const [narutoEp, setNarutoEp] = useState<number | null>(null)
  const [narutoConfirm, setNarutoConfirm] = useState<
    { watched: number; minutes: number; proposed: number; adjusting: boolean } | null
  >(null)
  const { show: showToast, ToastContainer } = useToast()
  const phaseRef = useRef<RunPhase>('ready')
  useEffect(() => { phaseRef.current = phase }, [phase])

  // ─── The recorder (page 74): the strap's heart rate and GPS distance, the zone ───
  // The run's line (the HR ceiling, e.g. 147): teal under, gold at the top, ember over for ~30 s.
  // A hard run has its own range: gold near the top, ember only HARD_OVER_BY over it for 30 s (page 76).
  const ceiling = hard ? hard.heart.top : prescription?.z2CeilingBpm ?? null
  const overBy = hard ? hard.heart.overBy : 0
  // One id per run; the same id rejoins the recording after a relaunch.
  const [runId, setRunId] = useState<string | null>(() => resume?.runId ?? null)
  const [live, setLive] = useState<{ hr: number | null; distanceM: number; link: StrapLink }>({ hr: null, distanceM: 0, link: 'none' })
  const zoneRef = useRef<ZoneTracker>(ZONE_START)
  const [zone, setZone] = useState<HrZone>('none')
  // The recording Log your run was filled from (kept for SAVE RUN).
  const recRef = useRef<RunRecording | null>(null)
  // Log your run after a finish: was the clock running? A tap outside puts it back exactly so.
  const [resumeOnClose, setResumeOnClose] = useState(() => draft.resumeOnClose === '1')

  const ticking = phase === 'running' && stopwatch?.state === 'running'
  useEffect(() => {
    if (!ticking) return
    const id = setInterval(() => setNowMs(Date.now()), 500)
    return () => clearInterval(id)
  }, [ticking])
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') setNowMs(Date.now())
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  // Save on every change: phase, clock, indoor choice and the log draft.
  useEffect(() => {
    onPersist?.({
      kind: 'run',
      sub: phase,
      stopwatch,
      isIndoor,
      media,
      draft: { distance, duration, avgHr, maxHr, onePaceArc, onePaceEp, ...(resumeOnClose ? { resumeOnClose: '1' } : {}), ...(talkTouched ? { talkHr: String(talkHr) } : {}), ...(fiveK ? { fiveK } : {}), ...(planShift ? { planShift: String(planShift) } : {}), ...(planMoves ? { planMoves: String(planMoves) } : {}) },
      ...(runId ? { runId } : {}),
    })
  }, [onPersist, phase, stopwatch, isIndoor, media, distance, duration, avgHr, maxHr, onePaceArc, onePaceEp, runId, resumeOnClose, talkTouched, talkHr, fiveK, planShift, planMoves])

  useWakeLock(ticking)

  function chooseMedia(next: IndoorMedia) {
    setMedia(next)
    storageSet(INDOOR_MEDIA_KEY, next)
  }

  // Naruto episode from settings; One Pace arc/ep too if not already set
  useEffect(() => {
    const fillOnePace = !runSession.onePaceArc && !runSession.onePaceEp
    apiFetch<{ onePaceArc?: string | null; onePaceEp?: string | null; narutoEp?: number | null } | null>('/api/settings')
      .then((s) => {
        if (fillOnePace && s?.onePaceArc) setOnePaceArc(s.onePaceArc)
        if (fillOnePace && s?.onePaceEp) setOnePaceEp(s.onePaceEp)
        if (typeof s?.narutoEp === 'number') setNarutoEp(s.narutoEp)
      })
      .catch((e) => {
        const message = e instanceof Error ? e.message : String(e)
        logger.warn('system', 'settings autofill load failed', { message }, 'GET /settings failed. Run form not prefilled from last run.')
      })
  }, [runSession.onePaceArc, runSession.onePaceEp])

  const startRun = useCallback(() => {
    const now = Date.now()
    setStopwatch({ state: 'running', startedAtMs: now })
    setNowMs(now)
    setPhase('running')
    // The recorder starts with the run and links the remembered strap by itself.
    setRunId(newIdempotencyKey())
    // Indoors the show opens; outdoors Waymark records the run itself (page 74: no Strava).
    if (isIndoor) window.open(media === 'naruto' ? NARUTO_NETFLIX_URL : ONEPACE_URL, '_blank')
  }, [isIndoor, media])

  // Start (or rejoin, same runId) the recording once the run is under way, also after a relaunch.
  const recording = phase !== 'ready' && stopwatch != null
  const recStartRef = useRef<string | null>(null)
  useEffect(() => {
    if (!recording || !stopwatch) return
    if (!runId) { setRunId(newIdempotencyKey()); return }
    if (recStartRef.current === runId) return
    recStartRef.current = runId
    const sw = stopwatch
    const started = sw.state === 'running' ? sw.startedAtMs : Date.now() - sw.elapsedMs
    runRecorder().start({ runId, sessionId: runSession.sessionId ?? '', runSessionId: runSession.id, outdoor: !isIndoor, ceilingBpm: ceiling, overBy, startedAtMs: started })
      .then(() => { if (sw.state === 'paused') return runRecorder().pause() })
      .catch(e => logger.warn('session', 'run recorder start failed', { message: e instanceof Error ? e.message : String(e) }, 'The run recorder did not start. The clock runs; no heart rate or distance.'))
  }, [recording, runId, stopwatch, runSession.sessionId, runSession.id, isIndoor, ceiling, overBy])

  // The clock's pause / go on, mirrored to the recorder.
  const clockPaused = stopwatch?.state === 'paused'
  const pausedSeen = useRef<boolean | null>(null)
  useEffect(() => {
    if (!recording) { pausedSeen.current = null; return }
    if (pausedSeen.current === clockPaused) return
    const first = pausedSeen.current == null
    pausedSeen.current = clockPaused
    if (first) return
    void (clockPaused ? runRecorder().pause() : runRecorder().resume()).catch(() => {})
  }, [recording, clockPaused])

  // Ticks (1 Hz): the number, the distance, and the zone stepped once per sample.
  useEffect(() => {
    if (!recording) return
    return runRecorder().onTick(t => {
      setLive({ hr: t.hr, distanceM: t.distanceM, link: t.link })
      if (t.nudge && t.nudgeKmh) setNudge({ n: t.nudge, kmh: t.nudgeKmh, at: Date.now() })
      const prev = zoneRef.current
      const next = nextZone(prev, t.hr, ceiling, t.t, overBy)
      zoneRef.current = next
      // Ember after ~30 s over: EASE OFF and one light buzz.
      if (enteredOver(prev.zone, next.zone)) void tapHaptic()
      setZone(next.zone)
    })
  }, [recording, ceiling, overBy])

  /** The clock's time as Log your run shows it ("20:06", or "20" on the minute). */
  function durationFromClock(sw: StopwatchSnap | null, now: number): string {
    const finalSec = sw ? Math.floor(stopwatchElapsedMs(sw, now) / 1000) : elapsed
    const mins = Math.floor(finalSec / 60)
    const secs = finalSec % 60
    return secs > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : String(mins)
  }

  /**
   * Log your run (page 74): after the 3 s grass hold, or END AND LOG under the ×.
   * The clock holds; the board fills itself from the recorder (km, time, avg and
   * max heart rate). A tap outside puts the run back exactly as it was.
   */
  function openLog() {
    const now = Date.now()
    // The 5K test is a normal run: he stops at 5.00 km and holds the grass. Its time is the running time
    // less the planned warm-up (the GPS's 5.00 km mark outside, when it has one); he can change it.
    if (hard?.kind === 'test' && stopwatch && !fiveK) {
      const t = Math.floor(stopwatchElapsedMs(stopwatch, now) / 1000)
      const open = (hardSegs ?? []).find(x => x.sec === Infinity)
      if (open && t > open.startSec) setFiveK(mmss(t - open.startSec))
    }
    setResumeOnClose(stopwatch?.state === 'running')
    setDuration(durationFromClock(stopwatch, now))
    setStopwatch(sw => (sw ? stopwatchPause(sw, now) : sw))
    setNowMs(now)
    setPhase('logging')
    const id = runId
    runRecorder().snapshot().then(rec => {
      if (!rec || rec.runId !== id) return
      recRef.current = rec
      fillFrom(rec)
    }).catch(() => {})
  }
  function fillFrom(rec: RunRecording) {
    const sum = summarizeRecording(rec)
    if (sum.distanceKm != null) setDistance(sum.distanceKm.toFixed(2))
    if (sum.avgHr != null) setAvgHr(String(sum.avgHr))
    // The talk-test drum starts at the strap's average once it is in (never a made-up 140 he did not set).
    if (sum.avgHr != null && !talkTouched) setTalkHr(talkTestStart(sum.avgHr))
    if (sum.maxHr != null) setMaxHr(String(sum.maxHr))
  }
  const [logLeaving, logAway] = useEaseAway()
  /** A tap outside Log your run (or CLOSE): the board eases away and the run carries on as it was, nothing saved. */
  function closeLog() {
    logAway(() => {
      const now = Date.now()
      setNowMs(now)
      if (resumeOnClose) setStopwatch(sw => (sw && sw.state === 'paused' ? stopwatchResume(sw, now) : sw))
      setResumeOnClose(false)
      setPhase('running')
    })
  }

  /**
   * Page 85, a Run-Walk or a hard run: the plan moves, the run clock, distance, heart rate and
   * recording go on. Skip (a swipe up, the lock screen's skip stone): the next piece starts now,
   * never the finish, never out of the test's 5 km. Back (a swipe down): the piece starts again;
   * again within 3 s, the piece before. Paused stays paused. The screen, the lock card, the
   * recorder's pieces and cues all follow from the shift (the effects below send them again).
   */
  function movePiece(move: PlanMove) {
    const plan = hardPlanSegs ?? planSegments
    if (phase !== 'running' || !stopwatch || !plan) return
    const now = Date.now()
    const next = movePlan(plan, planShift, Math.floor(stopwatchElapsedMs(stopwatch, now) / 1000), move)
    if (next == null) return
    setPlanShift(next)
    setPlanMoves(m => m + 1)
    setNowMs(now)
  }
  const skipPiece = () => movePiece('skip')
  function backPiece() {
    const now = Date.now()
    const step = backStep(lastBackAt.current, now)
    lastBackAt.current = now
    movePiece(step)
  }

  async function handleSave() {
    setSaving(true)
    let durationSec: number | undefined
    if (duration) {
      durationSec = parseDurationToSec(duration) ?? undefined
    }
    const distanceKm = distance ? parseFloat(distance) : undefined
    const paceSecKm = distanceKm && durationSec ? Math.round(durationSec / distanceKm) : undefined
    const avgHrNum = avgHr ? parseInt(avgHr, 10) : undefined
    const maxHrNum = maxHr ? parseInt(maxHr, 10) : undefined

    try {
      // The recording goes up once, through the outbox (runId = its Idempotency-Key); then the log as he saw it.
      const rec = (await runRecorder().stop().catch(() => null)) ?? recRef.current
      const recorded = !!rec && rec.runId === runId
      if (rec && recorded) {
        recRef.current = rec
        await uploadRecording(rec)
      }
      const write = runLogWrite(runSession.id, runSession.sessionId ?? null, {
        // Page 76: the 5K test's time for the 5 km (it sets the next 4 weeks' speeds).
        ...(hard?.kind === 'test' ? { fiveKSec: parseFiveK(fiveK) } : {}),
        distanceKm, durationSec, paceSecKm,
        isIndoor: isIndoor ? 1 : 0,
        onePaceArc: isIndoor && media === 'one_pace' && onePaceArc ? onePaceArc : undefined,
        onePaceEp: isIndoor && media === 'one_pace' && onePaceEp ? onePaceEp : undefined,
        avgHr: Number.isFinite(avgHrNum) ? avgHrNum : undefined,
        maxHr: Number.isFinite(maxHrNum) ? maxHrNum : undefined,
        ...(showRunRealityMark ? { shortReason: endReason } : {}),
      })
      // Sent straight when nothing of this session waits on the phone (its answer carries the
      // line after SAVE RUN); otherwise, or with no signal, through the outbox behind those
      // writes and before the finish. Queued, the finish goes on as if saved.
      let res: { post?: PostRunFacts | null } | null = null
      let result: QueueResult = 'sent'
      if (pendingWrites(write.sessionId ?? undefined) === 0) {
        try {
          res = await apiFetch<{ post?: PostRunFacts | null } | null>(write.path, { method: write.method, body: JSON.stringify(write.body) })
        } catch (err) {
          if (!keepForRetry(err)) throw err
          result = await queueWrite(write)
        }
      } else {
        result = await queueWrite(write)
      }
      if (result === 'rejected') throw new Error('run log refused by the server')
      if (result === 'queued') {
        logger.warn('session', 'run log queued', { runSessionId: runSession.id }, 'Run log save failed. Kept on this phone, retrying.')
        showToast("No connection. Run saved on this phone. It syncs when you're back online.", 'warning')
      }

      // A recorded run can raise his max HR (the ingest's sustained max): say so once.
      const maxHrBumped = recorded ? await checkMaxHrBump(showToast) : false

      // The talk test (Block Zero week 1 / 6): that week's talk_test_hr, which sets the Zone 2 cap.
      const talkBody = talkTest ? talkTestToSave(talkTest.week, talkHr, talkTouched) : null
      if (talkTest && talkBody) {
        await apiFetch(`/api/blocks/${talkTest.blockId}/tests`, {
          method: 'POST',
          body: JSON.stringify(talkBody),
        }).catch((err) => {
          logger.warn('session', 'talk test save failed', {
            message: err instanceof Error ? err.message : String(err),
          }, 'POST /blocks/:id/tests talk_test_hr failed. Run saved, talk test not.')
          showToast("Talk-test heart rate didn't save. The run did.", 'warning')
        })
      }

      // Page 76 §4b: SAVED and the one line on the board, then on (by itself, or a tap).
      const line = res?.post ? postRunShort(res.post, unit) : null
      const goOn = () => {
      // Naruto: ask before moving the episode on. Never advance silently.
      if (isIndoor && media === 'naruto') {
        const watched = narutoEpisodesWatched(durationSec)
        if (watched > 0 && durationSec) {
          setNarutoConfirm({
            watched,
            minutes: Math.round(durationSec / 60),
            proposed: narutoNextEp(narutoEp, watched),
            adjusting: false,
          })
          setSaving(false)
          return
        }
      }

      if (isIndoor && media === 'one_pace' && onePaceEp) {
        const oldEp = onePaceEp
        const newEp = String(Number(oldEp) + 1)
        apiFetch('/api/settings', {
          method: 'PATCH',
          body: JSON.stringify({ onePaceEp: newEp }),
        }).catch((err) => console.error('Failed to bump onePaceEp:', err))
        showToast(`Ep ${oldEp} → Ep ${newEp}`, 'success')
        setTimeout(() => onComplete(), 1800)
        return
      }

      if (maxHrBumped) {
        setTimeout(() => onComplete(), 1800)
        return
      }
      onComplete()
      }
      if (!line) { goOn(); return }
      afterSave.current = goOn
      setSaved({ line })
      setSaving(false)
      window.setTimeout(closeSaved, SAVED_MS)
    } catch (e) {
      logger.warn('session', 'run log save failed', { runSessionId: runSession.id, message: e instanceof Error ? e.message : String(e) }, 'PATCH /run-sessions/:id failed. Run not saved.')
      showToast("Run didn't save. Try again.", 'warning')
      setSaving(false)
    }
  }

  /** The saved board closes (by itself after SAVED_MS, or a tap): the rest of the finish goes on. */
  function closeSaved() {
    const f = afterSave.current
    if (!f) return
    afterSave.current = null
    setSaved(null)
    f()
  }

  async function confirmNarutoEp() {
    if (!narutoConfirm) return
    const ep = narutoConfirm.proposed
    setSaving(true)
    try {
      await apiFetch('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ narutoEp: ep, narutoArc: narutoArcForEp(ep) }),
      })
      setNarutoEp(ep)
      showToast(`Naruto ep ${ep}`, 'success')
      setTimeout(() => onComplete(), 1200)
    } catch (err) {
      logger.warn('session', 'naruto ep save failed', {
        message: err instanceof Error ? err.message : String(err),
      }, 'PATCH /settings narutoEp failed. Run saved, episode not moved.')
      showToast('Episode not saved. Try again.', 'warning')
      setSaving(false)
    }
  }

  function stepNarutoProposed(delta: number) {
    setNarutoConfirm(c => c && {
      ...c,
      proposed: Math.min(NARUTO_EPISODES, Math.max(1, c.proposed + delta)),
    })
  }


  // A walk-only dose (audit #8): EASY WALK OR BIKE everywhere, never RUN, RUNNING or an HR cap.
  const walkOnly = isWalkOnly(prescription)
  const isZone2 = prescription?.runType === 'zone2' && !walkOnly
  // One name (audit #14): the dose's, as on its row; else the run's kind.
  const runTypeLabel = walkOnly ? WALK_ONLY_NAME : prescription?.name ?? (prescription ? (RUN_TYPE_LABELS[prescription.runType] ?? 'Run') : 'Zone 2 Run')
  const timerEstimate = prescription?.targetDurSec ?? 3600

  // The whole run's time left, on the plan's clock (a skip brings the end nearer; Zone 2 never shifts).
  const remaining = Math.max(0, timerEstimate - planShift - elapsed)
  // The run-walk's intervals on the same run clock (null: one countdown, as before), moved by the swipes.
  const planSegments = useMemo(() => runWalkSegments(prescription?.runWalk), [prescription?.runWalk])
  const segments = useMemo(() => (planSegments ? planOnRunClock(planSegments, planShift) : null), [planSegments, planShift])
  const rwPos = segments ? runWalkAt(segments, elapsed) : null
  const rwIndex = rwPos?.index ?? -1

  // ─── A hard run's pieces on the run clock (page 76 §4) ───
  const hardPlanSegs = useMemo(() => (hard ? hardSegments(hard) : null), [hard])
  const hardSegs = useMemo(() => (hardPlanSegs ? planOnRunClock(hardPlanSegs, planShift) : null), [hardPlanSegs, planShift])
  const hPos = hardSegs ? hardAt(hardSegs, elapsed) : null
  // The lock card's change counter (lib/lockGlow): the piece, moved on by 2 at every swipe so a
  // restart (same piece) and a step back (piece before) flash the card as a natural change does.
  const glowSeqOf = (index: number) => Math.max(0, index) + 1 + 2 * planMoves
  const hSeg: HardSegment | null = hPos && !hPos.done ? hPos.segment : null
  // Outside, the GPS marks the time at 5.00 km from where the 5 km began (finishing is still the grass hold).
  // A swipe down restarts the 5 km from here (its start moves): the mark starts again too.
  const testFrom = useRef<{ startSec: number; distM: number } | null>(null)
  useEffect(() => {
    if (!hSeg || hSeg.sec !== Infinity || isIndoor) { if (!hSeg || hSeg.sec !== Infinity) testFrom.current = null; return }
    if (testFrom.current?.startSec !== hSeg.startSec) { testFrom.current = { startSec: hSeg.startSec, distM: live.distanceM }; return }
    if (!fiveK && live.distanceM - testFrom.current.distM >= 5000) setFiveK(mmss(Math.max(0, elapsed - hSeg.startSec)))
    // Only each distance tick matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hSeg?.sec, hSeg?.startSec, live.distanceM, isIndoor])
  // The recorder plays the cues by itself on the run clock (locked too); sent again after a skip, a
  // resume, the 5 km, a unit or place change. Paused: it waits. After a swipe (page 85) the new piece's
  // words are due at the clock now, so the recorder plays them as at a natural change.
  const cueKey = hard && hardSegs && phase === 'running' && stopwatch?.state === 'running' && runId ? `${runId}:${stopwatch.startedAtMs}:${isIndoor}:${unit}:${planShift}:${planMoves}` : null
  useEffect(() => {
    if (!cueKey || !hardSegs || !stopwatch) return
    const clockSec = Math.floor(stopwatchElapsedMs(stopwatch, Date.now()) / 1000)
    void runRecorder().cues({ cues: hardCues(hardSegs, !isIndoor, unit), clockSec, outdoor: !isIndoor, unit, nudge: isIndoor ? [] : nudgeTargets(hardSegs) }).catch(() => {})
    // cueKey holds every input that matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cueKey])
  // Page 84: the pieces, for the recorder to move the lock card on at each one while the phone is
  // locked (sent with the run clock now, again after a skip or a resume, as the cues are).
  // A swipe sends them again on the moved plan, the change counter (seq) moved on so the card flashes.
  const pieceKey = (hardSegs || segments) && phase === 'running' && stopwatch?.state === 'running' && runId ? `${runId}:${stopwatch.startedAtMs}:${planShift}:${planMoves}` : null
  useEffect(() => {
    if (!pieceKey || !stopwatch) return
    const clockSec = Math.floor(stopwatchElapsedMs(stopwatch, Date.now()) / 1000)
    const list: RecorderPiece[] = hardSegs && hard
      ? hardSegs.map((h, i) => ({ startSec: h.startSec, sec: Number.isFinite(h.sec) ? h.sec : 0, open: !Number.isFinite(h.sec), estSec: hard.pieces[i]?.sec ?? h.sec, phase: phaseTone(h.kind) === 'teal' ? 'rest' as const : 'active' as const, word: phaseWord(h.kind), round: h.round, total: h.round > 0 ? hard.reps : 0, seq: glowSeqOf(i) }))
      : (segments ?? []).map((g, i) => ({ startSec: g.startSec, sec: g.sec, open: false, estSec: g.sec, phase: g.kind === 'run' ? 'active' as const : 'rest' as const, round: g.round, total: g.round > 0 ? (prescription?.runWalk?.rounds ?? 0) : 0, seq: glowSeqOf(i) }))
    void runRecorder().pieces({ pieces: list, clockSec }).catch(() => {})
    // pieceKey holds every input that matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pieceKey])
  // A nudge shows for 6 s.
  useEffect(() => {
    if (!nudge) return
    const t = window.setTimeout(() => setNudge(null), 6000)
    return () => window.clearTimeout(t)
  }, [nudge])

  // A cue at every run / walk change while the app is open (the lock screen gets notifications);
  // a swipe (page 85) sounds the same, a restart of the same piece too.
  const rwIndexRef = useRef<string | null>(null)
  const rwMark = `${rwIndex}:${planMoves}`
  useEffect(() => {
    if (phase !== 'running' || !segments || rwIndex < 0) { rwIndexRef.current = null; return }
    const prev = rwIndexRef.current
    rwIndexRef.current = rwMark
    if (prev == null || prev === rwMark || rwPos?.done) return
    if (segments[rwIndex].kind === 'run') soundRoundStart()
    else soundRoundEnd()
    mediumHaptic()
  }, [phase, segments, rwIndex, rwMark, rwPos?.done])

  // Locked screen: every change is scheduled up front from the clock's start; a pause cancels them.
  const rwCueStart = phase === 'running' && segments && stopwatch?.state === 'running' ? stopwatch.startedAtMs : null
  useEffect(() => {
    if (!segments || rwCueStart == null) { void cancelRunWalkCues(); return }
    void scheduleRunWalkCues(rwCueStart, runWalkCueTimes(segments))
  }, [segments, rwCueStart])
  useEffect(() => () => { void cancelRunWalkCues() }, [])
  const loggedDurationSec = parseDurationToSec(duration)
  const runReality = assessRunCompletion({
    plannedDurationSec: prescription?.targetDurSec ?? runSession.plannedDurationSec,
    completedDurationSec: loggedDurationSec,
  })
  const showRunRealityMark = shouldShowRunRealityMark(runReality.completionStatus)

  // Ring a bell once when the target duration is hit. Same bell family as bag
  // round-end so the sound vocabulary is consistent across engines.
  const targetHitRef = useRef(false)
  useEffect(() => {
    // A hard run's finish is the recorder's "Done. Nice work." (page 76).
    if (!hard && phase === 'running' && remaining === 0 && elapsed > 0 && !targetHitRef.current) {
      targetHitRef.current = true
      soundRoundEnd()
    }
  }, [phase, remaining, elapsed, hard])

  const toggleRunPause = useCallback(() => {
    if (phase !== 'running') return
    const now = Date.now()
    setNowMs(now)
    setStopwatch(sw => (!sw ? sw : sw.state === 'paused' ? stopwatchResume(sw, now) : stopwatchPause(sw, now)))
  }, [phase])

  // Live Activity for run. Indoor surfaces the One Piece arc/episode so a
  // glance at the Dynamic Island shows what's playing. Arc + Ep must live
  // together in `detail` — the Dynamic Island expanded view only renders
  // detail, not label, so "Ep 3" alone would be meaningless without the arc.
  const indoorLabel = media === 'naruto' ? 'Naruto' : 'One Piece'
  const indoorDetail = isIndoor && media === 'naruto'
    ? (narutoEp != null ? `Ep ${narutoEp}` : 'Netflix')
    : isIndoor
    ? (onePaceArc && onePaceEp
        ? `${onePaceArc} · Ep ${onePaceEp}`
        : onePaceArc || (onePaceEp ? `Ep ${onePaceEp}` : undefined))
    : 'Outdoor'
  // The painted icon on the lock screen: the Zone 2 dial or the run shoe.
  const runIconKey = isZone2 || runSession.runType === 'zone2' ? 'zone2' as const : 'run' as const
  // Page 74: the heart rate, its zone, the distance and the run's kind ride along on every update
  // (an easy run is pause / play only; a run-walk can skip to the next piece). Never end, log or discard.
  const runExtras = {
    hr: live.hr,
    hrZone: zone,
    ...(!isIndoor ? { distanceKm: Math.round(live.distanceM / 10) / 100 } : {}),
    runKind: hard ? 'hard' as const : segments ? 'runwalk' as const : 'easy' as const,
    // A run-walk's piece on the island ("RUN 3 OF 6"); its walks are the teal rest.
    ...(rwPos && !rwPos.done && rwPos.segment.round > 0 ? { stepIndex: rwPos.segment.round, stepTotal: prescription?.runWalk?.rounds ?? 0 } : {}),
    // A hard run's piece (page 76): RUN HARD 3 OF 6, EASY JOG (teal), TEMPO, 5K.
    ...(hard && hSeg ? { runPhase: phaseWord(hSeg.kind), ...(hSeg.round > 0 ? { stepIndex: hSeg.round, stepTotal: hard.reps } : {}) } : {}),
    // Page 82: the moment's colour and the change counter (each piece; Zone 2: the run's time reached).
    ...(hard && hPos
      ? { ...hardRunGlow(hPos.index, hSeg != null && phaseTone(hSeg.kind) === 'teal', zone === 'over'), glowSeq: glowSeqOf(hPos.index) }
      : rwPos
        ? { ...runWalkGlow(rwPos.index, !rwPos.done && rwPos.segment.kind !== 'run', zone), glowSeq: glowSeqOf(rwPos.index) }
        : zone2Glow(zone, remaining === 0 && elapsed > 0)),
  }
  const livePiece: RunPiece | null = hard && hSeg
    ? { startSec: hSeg.startSec, sec: hSeg.sec, estSec: hard.pieces[hPos?.index ?? 0]?.sec ?? 1500 }
    : rwPos && !rwPos.done ? { startSec: rwPos.segment.startSec, sec: rwPos.segment.sec } : null
  const rwWalking = (!!rwPos && !rwPos.done && rwPos.segment.kind !== 'run') || (hSeg != null && phaseTone(hSeg.kind) === 'teal')
  const runLiveConfig: LiveActivityConfig | null =
    phase === 'running' && runStartedAtMs > 0
      ? {
          sessionType: 'run',
          sessionLabel: isIndoor ? indoorLabel : walkOnly ? WALK_ONLY_NAME : 'Run',
          state: {
            phase: rwWalking ? 'rest' : 'active',
            iconKey: runIconKey,
            label: isIndoor ? indoorLabel : runTypeLabel,
            detail: indoorDetail,
            // Page 84: the piece you're in (a Run-Walk's run or walk, a hard run's piece), as the
            // app counts it; one countdown for the whole run otherwise. The open 5 km counts up.
            ...(livePiece
              ? { ...pieceTimes(livePiece, runStartedAtMs, elapsed, runPaused), isPaused: runPaused }
              : {
                  startedAt: runStartedAtMs,
                  endsAt: runPaused ? nowMs + remaining * 1000 : runStartedAtMs + (timerEstimate - planShift) * 1000,
                  isPaused: runPaused,
                  pausedRemaining: runPaused ? remaining : undefined,
                }),
            ...runExtras,
          },
        }
      : phase === 'logging' && runStartedAtMs > 0
        ? {
            sessionType: 'run',
            sessionLabel: isIndoor ? indoorLabel : walkOnly ? WALK_ONLY_NAME : 'Run',
            state: {
              phase: 'complete',
              iconKey: runIconKey,
              label: runTypeLabel,
              detail: indoorDetail,
              startedAt: runStartedAtMs,
              endsAt: nowMs,
              isPaused: false,
              completeMessage: 'Log your run',
              runKind: runExtras.runKind,
            },
          }
        : null

  useSessionLiveActivity(runLiveConfig, {
    onPause: () => {
      if (phase === 'running' && !runPaused) toggleRunPause()
    },
    onResume: () => {
      if (phase === 'running' && runPaused) toggleRunPause()
    },
    onEnd: () => {
      // The card swiped away leaves the session (still in progress, resumable); nothing ends.
      onExit?.()
    },
    // The skip stone (a Run-Walk or a hard run): the next piece, as the grass's swipe up. An easy run has no skip,
    // and nothing on the lock screen ever finishes the run.
    onAdvance: () => {
      if (phase === 'running' && (segments || hardSegs)) skipPiece()
    },
  })

  // Ready is a board over the forest (page 31); the run, and Log your run over it (page 74), are on the dark ground.
  useEffect(() => {
    setWorldBackdrop(phase === 'ready' || narutoConfirm ? 'clearing' : null)
    return () => setWorldBackdrop(null)
  }, [phase, narutoConfirm])

  // A Block Zero run-walk is RUN-WALK here too, as on its row (m9).
  const runTitle = hard && !walkOnly ? runTypeLabel.toUpperCase() : walkOnly ? 'WALK OR BIKE' : prescription?.runWalk ? 'RUN-WALK' : prescription?.name === 'Zone 2 Run' ? 'ZONE 2 RUN' : (prescription ? RUN_TITLES[prescription.runType] : null) ?? 'RUN'
  const icon = isZone2 || runSession.runType === 'zone2' ? 'zone2' as const : 'run' as const
  const targetMin = prescription?.targetDurSec ? Math.round(prescription.targetDurSec / 60) : null

  // ─── Ready (page 31 "Zone 2 · ready, indoor" / "Progression · ready, outdoor"; page 74: the plan lives here) ───
  if (phase === 'ready') {
    const eyebrow = walkOnly ? 'Easy day' : hard ? (new Date().getHours() < 12 ? 'Morning Run' : 'Evening Run') : isZone2 ? 'Morning Run' : prescription ? `Week ${prescription.weekNumber}` : 'Run'
    const onePaceWhy = [onePaceArc, onePaceEp ? `Ep ${onePaceEp}` : ''].filter(Boolean).join(' · ') || 'onepace.net'
    const hrLine = !walkOnly && (isZone2 || ceiling != null)
    const shape = runShape(prescription)
    return (
      <>
        <CentredCard label={`${runTypeLabel}, ready`} head={eyebrow} headRight={<SessionIcon kind={icon} size={34} />} onDismiss={onExit} closeOnOutside={false} className="ss-card">
          <div style={{ margin: '4px 0 10px' }}><FlapLabel text={runTypeLabel} size="lg" fit /></div>
          <div className="ss-rows">
            {hard && !walkOnly ? <HardRows hard={hard} outdoor={!isIndoor} unit={unit} targetMin={targetMin} /> : (
              <>
                {targetMin != null && <TargetRow k="Time" v={`${targetMin} MIN`} />}
                {hrLine && <TargetRow k="Heart rate" v={ceiling != null ? `≤ ${ceiling}` : 'TALK TEST'} tone="teal" />}
                {hrLine && <TargetRow k="Breathing" v="NASAL" />}
                {shape && <TargetRow k="Shape" v={shape} fit />}
                {prescription?.targetDistKm != null && <TargetRow k="Distance" v={`${prescription.targetDistKm} KM`} />}
              </>
            )}
          </div>
          <div className="ss-seg2" role="radiogroup" aria-label="Where">
            <button type="button" role="radio" aria-checked={!isIndoor} onClick={() => setIsIndoor(false)}><FlapLabel text="OUTDOOR" size="sm" tone={!isIndoor ? 'gold' : 'ink'} /></button>
            <button type="button" role="radio" aria-checked={isIndoor} onClick={() => setIsIndoor(true)}><FlapLabel text="INDOOR" size="sm" tone={isIndoor ? 'gold' : 'ink'} /></button>
          </div>
          {isIndoor ? (
            <>
              <div className="wm-mlabel" style={{ marginTop: 10 }}>{walkOnly ? 'WATCH WHILE YOU GO' : 'WATCH WHILE YOU RUN'}</div>
              <div className="wm-deps" role="radiogroup" aria-label="Watch while you run">
                <div className={`wm-dep${media === 'one_pace' ? ' is-pick' : ''}`}>
                  <button type="button" role="radio" aria-checked={media === 'one_pace'} className="wm-dep-main" onClick={() => chooseMedia('one_pace')}>
                    <span className="wm-dep-text"><FlapLabel text="ONE PACE" size="sm" /><span className="wm-dep-why">{onePaceWhy}</span></span>
                  </button>
                </div>
                <div className={`wm-dep${media === 'naruto' ? ' is-pick' : ''}`}>
                  <button type="button" role="radio" aria-checked={media === 'naruto'} className="wm-dep-main" onClick={() => chooseMedia('naruto')}>
                    <span className="wm-dep-text"><FlapLabel text="NARUTO" size="sm" /><span className="wm-dep-why">Netflix app</span></span>
                  </button>
                </div>
              </div>
            </>
          ) : null}
          <div className="wm-btns" style={{ marginTop: 12 }}>
            <SessionButton label={walkOnly ? 'START' : 'START RUN'} primary onClick={startRun} />
          </div>
        </CentredCard>
        <ToastContainer />
      </>
    )
  }

  // ─── After an indoor Naruto run (page 46): NOW ON EP N?, the episode on drums, YES ───
  if (narutoConfirm) {
    return (
      <>
        <NarutoEpisodeCard
          proposed={narutoConfirm.proposed}
          watched={narutoConfirm.watched}
          minutes={narutoConfirm.minutes}
          saving={saving}
          onStep={stepNarutoProposed}
          onYes={() => void confirmNarutoEp()}
          onSkip={onComplete}
        />
        <ToastContainer />
      </>
    )
  }

  // ─── Running (page 74: the countdown, RUNNING, the heart, BPM and distance; hold the grass to finish) ───
  // Run-walk: the clock counts down the interval you are in (WALK teal like a rest, RUN gold),
  // with RUN 2/6 beside the title. Without intervals: the one countdown.
  const logging = phase === 'logging'
  // Page 85: the swipes, on a Run-Walk and a hard run only (Zone 2 and Walk or Bike are one piece).
  // Up only while there is a next piece to go to (not the last, not the test's open 5 km).
  const pieceRun = !walkOnly && (hardSegs != null || segments != null)
  const canBack = pieceRun && !logging
  const canSkip = canBack && (hPos ? !hPos.done && hPos.index < (hardSegs?.length ?? 0) - 1 && Number.isFinite(hPos.segment.sec) : !!rwPos && !rwPos.done && rwPos.index < (segments?.length ?? 0) - 1)
  const seg = rwPos && !rwPos.done ? rwPos.segment : null
  const walking = seg != null && seg.kind !== 'run'
  const shown = seg ? rwPos!.remainingSec : Math.max(0, remaining)
  const heat = seg ? (walking ? null : heatFor(shown)) : remaining > 0 ? heatFor(shown) : null
  const segEnd = seg ? seg.startSec + seg.sec : timerEstimate - planShift
  const track: TimerTrack = {
    durationSec: seg ? seg.sec : timerEstimate,
    endsAtMs: runPaused || !runStartedAtMs ? null : runStartedAtMs + segEnd * 1000,
    remainingMs: shown * 1000,
  }
  const rounds = prescription?.runWalk?.rounds ?? 0
  // Ember after ~30 s over the line: EASE OFF takes RUNNING's (or RUN's) place.
  const over = zone === 'over'
  const word = seg ? (walking ? runWalkWord(seg.kind) : workLabel(runWalkWord(seg.kind), shown)) : workLabel(walkOnly ? 'EASY' : 'RUNNING', remaining > 0 ? shown : 99)
  const label = over ? 'EASE OFF' : word
  const labelTone = over ? 'clay' as const : walking ? 'teal' as const : 'gold' as const
  // The heart and the number: teal in the zone, gold at the top, ember over; dim with dashes without the strap.
  const strapOn = zone !== 'none' && live.hr != null
  const filled = !!recRef.current && avgHr !== ''
  const heartRow = (
    <div className="ss-live" data-live data-zone={zone}>
      <span className="ss-stt">
        <span className="ss-hshow"><HeartContainer size={84} bpm={strapOn ? live.hr : null} state={strapOn ? heartState(zone) : 'idle'} label={strapOn ? `Heart rate ${live.hr}` : 'No heart rate strap'} /></span>
        <FlapLabel text={strapOn ? String(live.hr) : '---'} size="lg" className={strapOn ? `ss-hrn${zone === 'gold' ? ' is-gold' : over ? ' is-over' : ''}` : 'ss-dashes'} />
        <span className="ss-u">BPM</span>
      </span>
    </div>
  )
  // ─── A hard run (page 76 §4): RUN HARD / EASY JOG big with "3 of 6", the piece's clock, the heart,
  // SPEED and INCLINE big (outside: PACE and KM), mph small while no unit is picked, NEXT small. ───
  const hp = hard && hPos ? hPos : null
  const hs = hp && !hp.done ? hp.segment : null
  const hEasy = hs != null && phaseTone(hs.kind) === 'teal'
  const hShown = hp ? hp.shownSec : 0
  const hHeat = hs && !hEasy && !hp?.up ? heatFor(hShown) : null
  const hDur = hs ? (hs.sec === Infinity ? hard?.pieces[hp?.index ?? 0]?.sec ?? 1500 : hs.sec) : timerEstimate
  const hTrack: TimerTrack = {
    durationSec: hDur,
    endsAtMs: runPaused || !runStartedAtMs || !hs || hs.sec === Infinity ? null : runStartedAtMs + (hs.startSec + hs.sec) * 1000,
    remainingMs: (hp?.up ? Math.max(0, hDur - hShown) : hShown) * 1000,
  }
  const kmh = hs?.kmh ?? hard?.speeds.easy ?? 0
  // Page 84: the piece word over the clock (96), ROUND / 3 / OF 6 under it (the jog after it: NEXT),
  // the heart, pace / KM or speed / incline, then NEXT · EASY JOG 2:00 · 18:40 LEFT. Tempo has no count.
  const hLast = hardSegs ? hardSegs[hardSegs.length - 1] : null
  const hEnd = hLast ? hLast.startSec + hLast.sec : Infinity
  const hLeft = Number.isFinite(hEnd) ? shortTime(Math.max(0, hEnd - elapsed)) : null
  const hNext = hardSegs && hp && hs && !hEasy && hs.sec !== Infinity && hardSegs[hp.index + 1] ? `NEXT · ${nextWords(hardSegs, hp.index).toUpperCase()}` : null
  const hCount = hs && hs.round > 0 && (hs.kind === 'hard' || hs.kind === 'jog')
    ? (hs.kind === 'hard' ? { label: 'ROUND', n: hs.round, tone: 'gold' as const } : hs.round < (hard?.reps ?? 0) ? { label: 'NEXT', n: hs.round + 1, tone: 'teal' as const } : null)
    : null
  const hardMid = hard && hp && (
    <TimerColumn className="is-run">
      <PhaseWord text={over ? 'EASE OFF' : hs ? phaseWord(hs.kind) : 'DONE'} tone={over ? 'clay' : hs ? phaseTone(hs.kind) : 'gold'} className={!over && hHeat ? `is-${hHeat}` : ''} />
      <HeroClock seconds={hShown} kind={hEasy ? 'rest' : 'work'} heat={over ? null : hHeat} tint={over ? 'clay' : hEasy ? 'rest' : 'work'} track={hTrack} px={96} />
      {hCount && <CountRow label={hCount.label} n={hCount.n} of={hard.reps} tone={hCount.tone} />}
      {heartRow}
      {isIndoor ? (
        <div className="ss-spd">
          <span className="ss-st2"><span className="ss-u">SPEED <b className="ss-uw">{speedUnitWord(unit)}</b></span><FlapLabel text={speedFlap(kmh, unit)} size="lg" /></span>
          <span className="ss-st2"><span className="ss-u">INCLINE</span><FlapLabel text={String(hard.incline ?? BASE_INCLINE)} size="lg" /></span>
        </div>
      ) : (
        <div className="ss-spd">
          <span className="ss-st2"><span className="ss-u">PACE <b className="ss-uw">{paceUnitWord(unit)}</b></span><FlapLabel text={paceFlap(kmh, unit)} size="lg" /></span>
          <span className="ss-st2"><span className="ss-u">KM</span><FlapLabel text={(live.distanceM / 1000).toFixed(2)} size="lg" /></span>
        </div>
      )}
      {nudge && !isIndoor && (
        <div className="ss-nudge" role="status"><FlapLabel text={nudgeWord(nudge.n).flap} size="xs" tone="clay" animate={false} /><span>{nudgeWord(nudge.n).to}</span><FlapLabel text={paceFlap(nudge.kmh, unit)} size="xs" animate={false} /></div>
      )}
      <NextLine lead={isIndoor ? altMph(kmh, unit) : null} next={hNext} left={hLeft} />
    </TimerColumn>
  )
  // Page 84, Zone 2 / Walk or Bike and Run-Walk: the word over the clock (Zone 2 112, 96 from 10:00;
  // Run-Walk 112), Run-Walk's ROUND / 2 / OF 6 (walking: NEXT), the heart, then KM small (Zone 2
  // outside) or NEXT · WALK 1:00 · 21:30 LEFT.
  const rwSeg = seg && rwPos ? rwPos : null
  const rwNextSeg = rwSeg && segments ? segments[rwSeg.index + 1] : null
  const rwCount = seg && seg.round > 0
    ? (seg.kind === 'run' ? { label: 'ROUND', n: seg.round, tone: 'gold' as const } : seg.round < rounds ? { label: 'NEXT', n: seg.round + 1, tone: 'teal' as const } : null)
    : seg && seg.kind === 'warmup' && rounds > 0 ? { label: 'NEXT', n: 1, tone: 'teal' as const } : null
  const easyMid = (
    <TimerColumn className="is-run">
      <PhaseWord text={label} tone={labelTone} className={!over && heat ? `is-${heat}` : ''} />
      <HeroClock seconds={shown} kind={walking ? 'rest' : 'work'} heat={over ? null : heat} tint={over ? 'clay' : walking ? 'rest' : 'work'} track={track} px={112} />
      {rwCount && <CountRow label={rwCount.label} n={rwCount.n} of={rounds} tone={rwCount.tone} />}
      {heartRow}
      {segments
        ? <NextLine next={seg && !walking && rwNextSeg ? `NEXT · ${runWalkWord(rwNextSeg.kind)} ${shortTime(rwNextSeg.sec)}` : null} left={shortTime(Math.max(0, remaining))} />
        : !isIndoor && <div className="tm-next">{(live.distanceM / 1000).toFixed(2)} KM</div>}
    </TimerColumn>
  )
  return (
    <>
      <SessionFrame
        title={runTitle}
        onEnd={onExit}
        onEndAndLog={openLog}
        closeHead={walkOnly ? sentenceCase(WALK_ONLY_NAME) : prescription?.runWalk ? 'Run-walk' : sentenceCase(runTypeLabel)}
        paused={runPaused && !logging}
        grass={hard ? <GrassZone track={hTrack} kind={hEasy ? 'rest' : 'work'} heat={hHeat} state={runPaused && !logging ? 'paused' : 'running'} onTap={toggleRunPause} onSkip={canSkip ? skipPiece : undefined} onBack={canBack ? backPiece : undefined} zone={zone} hold={{ onHeld: openLog, held: logging }} />
          : <GrassZone track={track} kind={walking ? 'rest' : 'work'} heat={heat} state={runPaused && !logging ? 'paused' : 'running'} onTap={toggleRunPause} onSkip={canSkip ? skipPiece : undefined} onBack={canBack ? backPiece : undefined} zone={zone} hold={{ onHeld: openLog, held: logging }} />}
      >
        {hardMid || easyMid}
      </SessionFrame>
      {logging && (
        // Log your run (page 74): filled by itself, no helper text. A tap outside (or CLOSE) puts
        // the run back exactly as it was, nothing saved; the grass eases back.
        <CentredCard label="Log your run" head="Log your run" headRight={saved ? <FlapLabel text="SAVED" size="xs" tone="teal" animate={false} /> : undefined} onDismiss={saved ? closeSaved : saving ? undefined : closeLog} className={`ss-card${logLeaving ? ' is-leaving' : ''}`}>
          <div className="ss-grid4">
            <ReadoutCell k="KM" value={distance} onChange={setDistance} inputMode="decimal" placeholder="5.0" />
            <ReadoutCell k="TIME" value={duration} onChange={setDuration} inputMode="numeric" placeholder="25:00" />
            <ReadoutCell k="AVG HR" value={avgHr} onChange={setAvgHr} inputMode="numeric" placeholder="138" />
            <ReadoutCell k="MAX HR" value={maxHr} onChange={setMaxHr} inputMode="numeric" placeholder="162" />
          </div>
          {/* Page 76 §6: the 5K test's time for the 5 km (the clock stamped it; tap to change). */}
          {hard?.kind === 'test' && !saved && <div className="ss-grid4 is-one"><ReadoutCell k="5K" value={fiveK} onChange={setFiveK} inputMode="numeric" placeholder="27:48" /></div>}
          {saved && <p className="ss-post1">{saved.line}</p>}
          {/* Without the strap the board is as it was (page 31): the one line on changing a number. */}
          {!saved && !talkTest && !filled && <p className="tm-note" style={{ margin: '-2px 0 0' }}>Tap a number to change it.</p>}
          {!saved && talkTest && (
            <div className="ss-talk">
              <FlapLabel text="TALK TEST" size="sm" tone="gold" />
              <p className="ss-q">Heart rate when full sentences got hard?</p>
              <div className="ss-drum2" role="group" aria-label="Talk-test heart rate, bpm">
                <button type="button" className="ss-ar" aria-label="Lower" disabled={talkHr <= TALK_TEST_RANGE.min} onClick={() => stepTalkHr(-TALK_TEST_RANGE.step)}>▼</button>
                <span className="ss-v" aria-live="polite"><FlapLabel text={String(talkHr)} size="xl" tone="gold" /><span className="ss-u">bpm</span></span>
                <button type="button" className="ss-ar" aria-label="Higher" disabled={talkHr >= TALK_TEST_RANGE.max} onClick={() => stepTalkHr(TALK_TEST_RANGE.step)}>▲</button>
              </div>
            </div>
          )}
          {!saved && isIndoor && media === 'one_pace' && (
            <div className="ss-two">
              <label className="ss-fld"><span className="wm-label">Arc</span><input className="ss-in" value={onePaceArc} onChange={e => setOnePaceArc(e.target.value)} placeholder="e.g. Water 7" /></label>
              <label className="ss-fld"><span className="wm-label">Episode</span><input className="ss-in" value={onePaceEp} onChange={e => setOnePaceEp(e.target.value)} placeholder="e.g. 3" inputMode="numeric" /></label>
            </div>
          )}
          {!saved && showRunRealityMark && <p className="tm-note" style={{ margin: 0 }}>Short run noted.</p>}
          {/* Cut short: one optional tap says why (NO TIME holds the next run; it never reads as too hard). */}
          {!saved && showRunRealityMark && <ReasonTiles tiles={EARLY_END_REASONS} value={endReason} onChange={setEndReason} />}
          {!saved && (
            <div className="wm-btns" style={{ marginTop: 12 }}>
              <SessionButton label={saving ? 'SAVING' : 'SAVE RUN'} primary disabled={saving} onClick={() => void handleSave()} />
            </div>
          )}
        </CentredCard>
      )}
      <ToastContainer />
    </>
  )
}

/** The ready board's Shape row (page 74): a run-walk's pieces, or one steady run for an easy / Zone 2 run. */
function runShape(p: RunPrescription | null | undefined): string | null {
  const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
  if (isWalkOnly(p)) return 'EASY WALK OR BIKE'
  if (p?.runWalk && p.runWalk.rounds > 0 && p.runWalk.runSec > 0) return `RUN ${mmss(p.runWalk.runSec)} · WALK ${mmss(p.runWalk.walkSec)}`
  if (!p || p.runType === 'zone2' || p.runType === 'easy') return 'ONE STEADY RUN'
  return null
}

/** A speed (or pace) row on the ready board: the flap and its unit word, small (page 76 §3). */
function NumRow({ k, v, u }: { k: string; v: string; u: string }) {
  return (
    <div className="ss-row">
      <span className="wm-label ss-grow">{k}</span>
      <span className="ss-spf"><FlapLabel text={v} size="sm" /><small className="ss-uw">{u}</small></span>
    </div>
  )
}

/**
 * A hard run's ready board in words (page 76 §3): how long, the pieces ("Run
 * hard 2 MIN, Then jog 2 MIN, Times 6"), the two speeds and the incline inside
 * (the two paces outside), and the most the heart should hit. No bar.
 */
function HardRows({ hard, outdoor, unit, targetMin }: { hard: HardPlan; outdoor: boolean; unit: TreadmillUnit; targetMin: number | null }) {
  const p = hard.pieces
  const minOf = (k: string) => Math.round((p.find(x => x.kind === k)?.sec ?? 0) / 60)
  const num = (k: string, kmh: number) => outdoor
    ? <NumRow key={k} k={`${k} pace`} v={paceFlap(kmh, unit)} u={paceUnitWord(unit)} />
    : <NumRow key={k} k={`${k} speed`} v={speedFlap(kmh, unit)} u={speedUnitWord(unit)} />
  const incline = outdoor ? null : <TargetRow k="Incline" v={String(hard.incline ?? BASE_INCLINE)} />
  if (hard.kind === 'test') {
    return (
      <>
        {targetMin != null && <TargetRow k="Time" v={`~${targetMin} MIN`} />}
        <TargetRow k="Run" v="5 KM" />
        {num('Start', hard.speeds.test)}
        {incline}
      </>
    )
  }
  if (hard.kind === 'steady') {
    return (
      <>
        {targetMin != null && <TargetRow k="Time" v={`${targetMin} MIN`} />}
        <TargetRow k="Tempo" v={`${minOf('steady')} MIN`} />
        {num('Hard', hard.speeds.steady)}
        {num('Easy', hard.speeds.easy)}
        {incline}
        <TargetRow k="Heart" v={hard.heart.low != null ? `${hard.heart.low}–${hard.heart.top}` : `UP TO ${hard.heart.top}`} tone="teal" />
      </>
    )
  }
  return (
    <>
      {targetMin != null && <TargetRow k="Time" v={`${targetMin} MIN`} />}
      <TargetRow k="Run hard" v={`${minOf('hard')} MIN`} />
      <TargetRow k="Then jog" v={`${minOf('jog')} MIN`} />
      <TargetRow k="Times" v={String(hard.reps)} />
      {num('Hard', hard.speeds.hard)}
      {num('Jog', hard.speeds.jog)}
      {incline}
      <TargetRow k="Heart" v={`UP TO ${hard.heart.top}`} tone="teal" />
    </>
  )
}

function TargetRow({ k, v, tone, fit = false }: { k: string; v: string; tone?: 'teal'; fit?: boolean }) {
  return (
    <div className="ss-row">
      <span className="wm-label ss-grow">{k}</span>
      <FlapLabel text={v} size="sm" tone={tone ?? 'ink'} fit={fit} />
    </div>
  )
}

/** A big flap readout; tap it to type the number (page 31 "Tap a number to change it."). */
function ReadoutCell({ k, value, onChange, inputMode, placeholder }: { k: string; value: string; onChange: (v: string) => void; inputMode: 'decimal' | 'numeric'; placeholder: string }) {
  const [editing, setEditing] = useState(false)
  return (
    <div className="ss-cell4" role="group" aria-label={k}>
      <span className="wm-label">{k}</span>
      {editing ? (
        <input
          className="ss-cellin"
          autoFocus
          inputMode={inputMode}
          value={value}
          placeholder={placeholder}
          aria-label={k}
          onChange={e => onChange(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        />
      ) : (
        <button type="button" className="ss-cellbtn" aria-label={`${k} ${value || 'not set'}. Change`} onClick={() => setEditing(true)}>
          <FlapLabel text={value || '-'} size="lg" fit />
        </button>
      )}
    </div>
  )
}
