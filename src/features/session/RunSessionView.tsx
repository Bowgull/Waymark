import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { CentredCard, FlapLabel, SessionIcon } from '@/design'
import { GrassZone, SessionButton, SessionFrame, sentenceCase, TimerFace, useEaseAway, type TimerTrack } from '@/components/timers'
import { HeartContainer } from '@/components/heart/HeartContainer'
import { useToast } from '@/components/ui/Toast'
import { EARLY_END_REASONS } from '@/components/ui/departures'
import { ReasonTiles } from '@/features/coach/ReasonTiles'
import { apiFetch } from '@/lib/api'
import { logger } from '@/lib/logger'
import { soundRoundEnd, soundRoundStart } from '@/lib/sounds'
import { mediumHaptic, tapHaptic } from '@/lib/haptics'
import { newIdempotencyKey } from '@/lib/api'
import { enteredOver, heartState, nextZone, ZONE_START, type HrZone, type ZoneTracker } from '@/lib/hrZoneState'
import { runRecorder, type StrapLink } from '@/lib/runRecorder'
import { summarizeRecording, type RunRecording } from '@/lib/runRecording'
import { uploadRecording } from '@/lib/runRecordingUpload'
import { cancelRunWalkCues, scheduleRunWalkCues } from '@/lib/notifications'
import { runWalkAt, runWalkCount, runWalkCueTimes, runWalkSegments, runWalkWord, type RunWalkShape } from '@/lib/timers/runWalk'
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
import { clampTalkHr, talkTestBody, talkTestStart, TALK_TEST_RANGE } from '@/lib/blockZero/talkTest'
import { heatFor, workLabel } from '@/lib/timers/timerLook'
import { useWakeLock } from '@/lib/wakeLock'
import { setWorldBackdrop } from '@/world/worldStore'

import '@/design/pickers.css'
import './session.css'
import { useSessionLiveActivity, type LiveActivityConfig } from './useSessionLiveActivity'
import { NarutoEpisodeCard } from './NarutoEpisodeCard'
import { checkMaxHrBump } from '@/lib/maxHrBump'

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
}

type RunPhase = 'ready' | 'running' | 'logging'
type RunState = Extract<EngineState, { kind: 'run' }>

const INDOOR_MEDIA_KEY = 'waymark_indoor_media'

function storedIndoorMedia(): IndoorMedia {
  return storageGet(INDOOR_MEDIA_KEY) === 'naruto' ? 'naruto' : 'one_pace'
}

const RUN_TYPE_LABELS: Record<string, string> = {
  zone2: 'Zone 2 Run',
  easy: 'Easy Run',
  easy_strides: 'Easy + Strides',
  tempo: 'Tempo Run',
  intervals: 'Intervals',
  '5k_test': '5K Test',
}

/** The run on the session flap (page 19: ZONE 2 · RUN). */
const RUN_TITLES: Record<string, string> = {
  zone2: 'ZONE 2',
  easy: 'EASY',
  easy_strides: 'EASY + STRIDES',
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
  const [media, setMedia] = useState<IndoorMedia>(() => resume?.media ?? storedIndoorMedia())
  // The run clock: wall-clock anchored (virtual start time, or elapsed when
  // paused), so a lock, a reload or a kill keeps the right time.
  const [stopwatch, setStopwatch] = useState<StopwatchSnap | null>(() => resume?.stopwatch ?? null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const runPaused = stopwatch?.state === 'paused'
  const elapsed = stopwatch ? Math.floor(stopwatchElapsedMs(stopwatch, nowMs) / 1000) : 0
  const runStartedAtMs = !stopwatch ? 0 : stopwatch.state === 'running' ? stopwatch.startedAtMs : nowMs - stopwatch.elapsedMs

  const [distance, setDistance] = useState(draft.distance ?? '')
  const [duration, setDuration] = useState(draft.duration ?? '')
  const [avgHr, setAvgHr] = useState(draft.avgHr ?? '')
  const [maxHr, setMaxHr] = useState(draft.maxHr ?? '')
  const [onePaceArc, setOnePaceArc] = useState(draft.onePaceArc ?? runSession.onePaceArc ?? '')
  const [onePaceEp, setOnePaceEp] = useState(draft.onePaceEp ?? runSession.onePaceEp ?? '')
  const [saving, setSaving] = useState(false)
  const [endReason, setEndReason] = useState<string | null>(null)
  const [talkHr, setTalkHr] = useState(() => talkTestStart(Number(draft.avgHr ?? runSession.avgHr ?? NaN)))
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
  const ceiling = prescription?.z2CeilingBpm ?? null
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
      draft: { distance, duration, avgHr, maxHr, onePaceArc, onePaceEp, ...(resumeOnClose ? { resumeOnClose: '1' } : {}) },
      ...(runId ? { runId } : {}),
    })
  }, [onPersist, phase, stopwatch, isIndoor, media, distance, duration, avgHr, maxHr, onePaceArc, onePaceEp, runId, resumeOnClose])

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
    runRecorder().start({ runId, sessionId: runSession.sessionId ?? '', runSessionId: runSession.id, outdoor: !isIndoor, ceilingBpm: ceiling, startedAtMs: started })
      .then(() => { if (sw.state === 'paused') return runRecorder().pause() })
      .catch(e => logger.warn('session', 'run recorder start failed', { message: e instanceof Error ? e.message : String(e) }, 'The run recorder did not start. The clock runs; no heart rate or distance.'))
  }, [recording, runId, stopwatch, runSession.sessionId, runSession.id, isIndoor, ceiling])

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
      const prev = zoneRef.current
      const next = nextZone(prev, t.hr, ceiling, t.t)
      zoneRef.current = next
      // Ember after ~30 s over: EASE OFF and one light buzz.
      if (enteredOver(prev.zone, next.zone)) void tapHaptic()
      setZone(next.zone)
    })
  }, [recording, ceiling])

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

  /** Run-walk, from the lock screen's skip stone: on to the next piece (run <-> walk). Never the finish. */
  function skipPiece() {
    if (!segments || phase !== 'running' || !stopwatch) return
    const now = Date.now()
    const elapsedMs = stopwatchElapsedMs(stopwatch, now)
    const pos = runWalkAt(segments, elapsedMs / 1000)
    if (pos.done || pos.index >= segments.length - 1) return
    const jumpMs = Math.max(0, (pos.segment.startSec + pos.segment.sec) * 1000 - elapsedMs)
    setStopwatch(sw => (!sw ? sw : sw.state === 'running' ? { state: 'running', startedAtMs: sw.startedAtMs - jumpMs } : { state: 'paused', elapsedMs: sw.elapsedMs + jumpMs }))
    setNowMs(now)
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
      await apiFetch(`/api/run-sessions/${runSession.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          distanceKm, durationSec, paceSecKm,
          isIndoor: isIndoor ? 1 : 0,
          onePaceArc: isIndoor && media === 'one_pace' && onePaceArc ? onePaceArc : undefined,
          onePaceEp: isIndoor && media === 'one_pace' && onePaceEp ? onePaceEp : undefined,
          avgHr: Number.isFinite(avgHrNum) ? avgHrNum : undefined,
          maxHr: Number.isFinite(maxHrNum) ? maxHrNum : undefined,
          ...(showRunRealityMark ? { shortReason: endReason } : {}),
        }),
      })

      // A recorded run can raise his max HR (the ingest's sustained max): say so once.
      const maxHrBumped = recorded ? await checkMaxHrBump(showToast) : false

      // The talk test (Block Zero week 1 / 6): that week's talk_test_hr, which sets the Zone 2 cap.
      if (talkTest) {
        await apiFetch(`/api/blocks/${talkTest.blockId}/tests`, {
          method: 'POST',
          body: JSON.stringify(talkTestBody(talkTest.week, talkHr)),
        }).catch((err) => {
          logger.warn('session', 'talk test save failed', {
            message: err instanceof Error ? err.message : String(err),
          }, 'POST /blocks/:id/tests talk_test_hr failed. Run saved, talk test not.')
          showToast("Talk-test heart rate didn't save. The run did.", 'warning')
        })
      }

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
    } catch (e) {
      console.error('Failed to save run:', e)
      setSaving(false)
    }
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


  const isZone2 = prescription?.runType === 'zone2'
  const runTypeLabel = prescription
    ? (RUN_TYPE_LABELS[prescription.runType] ?? 'Run')
    : 'Easy Run'
  const timerEstimate = prescription?.targetDurSec ?? 3600

  const remaining = Math.max(0, timerEstimate - elapsed)
  // The run-walk's intervals on the same run clock (null: one countdown, as before).
  const segments = useMemo(() => runWalkSegments(prescription?.runWalk), [prescription?.runWalk])
  const rwPos = segments ? runWalkAt(segments, elapsed) : null
  const rwIndex = rwPos?.index ?? -1

  // A cue at every run / walk change while the app is open (the lock screen gets notifications).
  const rwIndexRef = useRef<number | null>(null)
  useEffect(() => {
    if (phase !== 'running' || !segments || rwIndex < 0) { rwIndexRef.current = null; return }
    const prev = rwIndexRef.current
    rwIndexRef.current = rwIndex
    if (prev == null || prev === rwIndex || rwPos?.done) return
    if (segments[rwIndex].kind === 'run') soundRoundStart()
    else soundRoundEnd()
    mediumHaptic()
  }, [phase, segments, rwIndex, rwPos?.done])

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
    if (phase === 'running' && remaining === 0 && elapsed > 0 && !targetHitRef.current) {
      targetHitRef.current = true
      soundRoundEnd()
    }
  }, [phase, remaining, elapsed])

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
    runKind: segments ? 'runwalk' as const : 'easy' as const,
    // A run-walk's piece on the island ("RUN 3 OF 6"); its walks are the teal rest.
    ...(rwPos && !rwPos.done && rwPos.segment.round > 0 ? { stepIndex: rwPos.segment.round, stepTotal: prescription?.runWalk?.rounds ?? 0 } : {}),
  }
  const rwWalking = !!rwPos && !rwPos.done && rwPos.segment.kind !== 'run'
  const runLiveConfig: LiveActivityConfig | null =
    phase === 'running' && runStartedAtMs > 0
      ? {
          sessionType: 'run',
          sessionLabel: isIndoor ? indoorLabel : 'Run',
          state: {
            phase: rwWalking ? 'rest' : 'active',
            iconKey: runIconKey,
            label: isIndoor ? indoorLabel : runTypeLabel,
            detail: indoorDetail,
            startedAt: runStartedAtMs,
            endsAt: runPaused
              ? nowMs + remaining * 1000
              : runStartedAtMs + timerEstimate * 1000,
            isPaused: runPaused,
            pausedRemaining: runPaused ? remaining : undefined,
            ...runExtras,
          },
        }
      : phase === 'logging' && runStartedAtMs > 0
        ? {
            sessionType: 'run',
            sessionLabel: isIndoor ? indoorLabel : 'Run',
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
    // The skip stone (run-walk only): the next piece, run <-> walk. An easy run has no skip,
    // and nothing on the lock screen ever finishes the run.
    onAdvance: () => {
      if (phase === 'running' && segments) skipPiece()
    },
  })

  // Ready is a board over the forest (page 31); the run, and Log your run over it (page 74), are on the dark ground.
  useEffect(() => {
    setWorldBackdrop(phase === 'ready' || narutoConfirm ? 'clearing' : null)
    return () => setWorldBackdrop(null)
  }, [phase, narutoConfirm])

  // A Block Zero run-walk is RUN-WALK here too, as on its row (m9).
  const runTitle = prescription?.runWalk ? 'RUN-WALK' : (prescription ? RUN_TITLES[prescription.runType] : null) ?? 'RUN'
  const icon = isZone2 || runSession.runType === 'zone2' ? 'zone2' as const : 'run' as const
  const targetMin = prescription?.targetDurSec ? Math.round(prescription.targetDurSec / 60) : null

  // ─── Ready (page 31 "Zone 2 · ready, indoor" / "Progression · ready, outdoor"; page 74: the plan lives here) ───
  if (phase === 'ready') {
    const eyebrow = isZone2 ? 'Morning Run' : prescription ? `Week ${prescription.weekNumber}` : 'Run'
    const onePaceWhy = [onePaceArc, onePaceEp ? `Ep ${onePaceEp}` : ''].filter(Boolean).join(' · ') || 'onepace.net'
    const hrLine = isZone2 || ceiling != null
    const shape = runShape(prescription)
    return (
      <>
        <CentredCard label={`${runTypeLabel}, ready`} head={eyebrow} headRight={<SessionIcon kind={icon} size={34} />} onDismiss={onExit} closeOnOutside={false} className="ss-card">
          <div style={{ margin: '4px 0 10px' }}><FlapLabel text={runTypeLabel} size="lg" fit /></div>
          <div className="ss-rows">
            {targetMin != null && <TargetRow k="Time" v={`${targetMin} MIN`} />}
            {hrLine && <TargetRow k="Heart rate" v={ceiling != null ? `≤ ${ceiling}` : 'TALK TEST'} tone="teal" />}
            {hrLine && <TargetRow k="Breathing" v="NASAL" />}
            {shape && <TargetRow k="Shape" v={shape} fit />}
            {prescription?.targetDistKm != null && <TargetRow k="Distance" v={`${prescription.targetDistKm} KM`} />}
          </div>
          <div className="ss-seg2" role="radiogroup" aria-label="Where">
            <button type="button" role="radio" aria-checked={!isIndoor} onClick={() => setIsIndoor(false)}><FlapLabel text="OUTDOOR" size="sm" tone={!isIndoor ? 'gold' : 'ink'} /></button>
            <button type="button" role="radio" aria-checked={isIndoor} onClick={() => setIsIndoor(true)}><FlapLabel text="INDOOR" size="sm" tone={isIndoor ? 'gold' : 'ink'} /></button>
          </div>
          {isIndoor ? (
            <>
              <div className="wm-mlabel" style={{ marginTop: 10 }}>WATCH WHILE YOU RUN</div>
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
            <SessionButton label="START RUN" primary onClick={startRun} />
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
  const seg = rwPos && !rwPos.done ? rwPos.segment : null
  const walking = seg != null && seg.kind !== 'run'
  const shown = seg ? rwPos!.remainingSec : Math.max(0, remaining)
  const heat = seg ? (walking ? null : heatFor(shown)) : remaining > 0 ? heatFor(shown) : null
  const segEnd = seg ? seg.startSec + seg.sec : timerEstimate
  const track: TimerTrack = {
    durationSec: seg ? seg.sec : timerEstimate,
    endsAtMs: runPaused || !runStartedAtMs ? null : runStartedAtMs + segEnd * 1000,
    remainingMs: shown * 1000,
  }
  const rounds = prescription?.runWalk?.rounds ?? 0
  // Ember after ~30 s over the line: EASE OFF takes RUNNING's (or RUN's) place.
  const over = zone === 'over'
  const word = seg ? (walking ? runWalkWord(seg.kind) : workLabel(runWalkWord(seg.kind), shown)) : workLabel('RUNNING', remaining > 0 ? shown : 99)
  const label = over ? 'EASE OFF' : word
  const labelTone = over ? 'clay' as const : walking ? 'teal' as const : 'gold' as const
  // The heart and the number: teal in the zone, gold at the top, ember over; dim with dashes without the strap.
  const strapOn = zone !== 'none' && live.hr != null
  const filled = !!recRef.current && avgHr !== ''
  return (
    <>
      <SessionFrame
        title={runTitle}
        count={seg ? runWalkCount(seg, rounds) : 'RUN'}
        onEnd={onExit}
        onEndAndLog={openLog}
        closeHead={prescription?.runWalk ? 'Run-walk' : sentenceCase(runTypeLabel)}
        paused={runPaused && !logging}
        grass={<GrassZone track={track} kind={walking ? 'rest' : 'work'} heat={heat} state={runPaused && !logging ? 'paused' : 'running'} onTap={toggleRunPause} zone={zone} hold={{ onHeld: openLog, held: logging }} />}
      >
        <div className="ss-runmid">
          <TimerFace big seconds={shown} kind={walking ? 'rest' : 'work'} tone={walking ? 'teal' : undefined} heat={over ? null : heat} label={label} labelTone={labelTone} track={track} />
          <div className="ss-live" data-live data-zone={zone}>
            <span className="ss-stt">
              <span className="ss-hshow"><HeartContainer size={84} bpm={strapOn ? live.hr : null} state={strapOn ? heartState(zone) : 'idle'} label={strapOn ? `Heart rate ${live.hr}` : 'No heart rate strap'} /></span>
              <FlapLabel text={strapOn ? String(live.hr) : '---'} size="lg" className={strapOn ? `ss-hrn${zone === 'gold' ? ' is-gold' : over ? ' is-over' : ''}` : 'ss-dashes'} />
              <span className="ss-u">BPM</span>
            </span>
            {!isIndoor && (
              <span className="ss-stt">
                <FlapLabel text={(live.distanceM / 1000).toFixed(2)} size="lg" />
                <span className="ss-u">KM</span>
              </span>
            )}
          </div>
        </div>
      </SessionFrame>
      {logging && (
        // Log your run (page 74): filled by itself, no helper text. A tap outside (or CLOSE) puts
        // the run back exactly as it was, nothing saved; the grass eases back.
        <CentredCard label="Log your run" head="Log your run" onDismiss={saving ? undefined : closeLog} className={`ss-card${logLeaving ? ' is-leaving' : ''}`}>
          <div className="ss-grid4">
            <ReadoutCell k="KM" value={distance} onChange={setDistance} inputMode="decimal" placeholder="5.0" />
            <ReadoutCell k="TIME" value={duration} onChange={setDuration} inputMode="numeric" placeholder="25:00" />
            <ReadoutCell k="AVG HR" value={avgHr} onChange={setAvgHr} inputMode="numeric" placeholder="138" />
            <ReadoutCell k="MAX HR" value={maxHr} onChange={setMaxHr} inputMode="numeric" placeholder="162" />
          </div>
          {/* Without the strap the board is as it was (page 31): the one line on changing a number. */}
          {!talkTest && !filled && <p className="tm-note" style={{ margin: '-2px 0 0' }}>Tap a number to change it.</p>}
          {talkTest && (
            <div className="ss-talk">
              <FlapLabel text="TALK TEST" size="sm" tone="gold" />
              <p className="ss-q">Heart rate when full sentences got hard?</p>
              <div className="ss-drum2" role="group" aria-label="Talk-test heart rate, bpm">
                <button type="button" className="ss-ar" aria-label="Lower" disabled={talkHr <= TALK_TEST_RANGE.min} onClick={() => setTalkHr(v => clampTalkHr(v - TALK_TEST_RANGE.step))}>▼</button>
                <span className="ss-v" aria-live="polite"><FlapLabel text={String(talkHr)} size="xl" tone="gold" /><span className="ss-u">bpm</span></span>
                <button type="button" className="ss-ar" aria-label="Higher" disabled={talkHr >= TALK_TEST_RANGE.max} onClick={() => setTalkHr(v => clampTalkHr(v + TALK_TEST_RANGE.step))}>▲</button>
              </div>
            </div>
          )}
          {isIndoor && media === 'one_pace' && (
            <div className="ss-two">
              <label className="ss-fld"><span className="wm-label">Arc</span><input className="ss-in" value={onePaceArc} onChange={e => setOnePaceArc(e.target.value)} placeholder="e.g. Water 7" /></label>
              <label className="ss-fld"><span className="wm-label">Episode</span><input className="ss-in" value={onePaceEp} onChange={e => setOnePaceEp(e.target.value)} placeholder="e.g. 3" inputMode="numeric" /></label>
            </div>
          )}
          {showRunRealityMark && <p className="tm-note" style={{ margin: 0 }}>Short run noted.</p>}
          {/* Cut short: one optional tap says why (NO TIME holds the next run; it never reads as too hard). */}
          {showRunRealityMark && <ReasonTiles tiles={EARLY_END_REASONS} value={endReason} onChange={setEndReason} />}
          <div className="wm-btns" style={{ marginTop: 12 }}>
            <SessionButton label={saving ? 'SAVING' : 'SAVE RUN'} primary disabled={saving} onClick={() => void handleSave()} />
          </div>
        </CentredCard>
      )}
      <ToastContainer />
    </>
  )
}

/** The ready board's Shape row (page 74): a run-walk's pieces, or one steady run for an easy / Zone 2 run. */
function runShape(p: RunPrescription | null | undefined): string | null {
  const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
  if (p?.runWalk && p.runWalk.rounds > 0 && p.runWalk.runSec > 0) return `RUN ${mmss(p.runWalk.runSec)} · WALK ${mmss(p.runWalk.walkSec)}`
  if (!p || p.runType === 'zone2' || p.runType === 'easy') return 'ONE STEADY RUN'
  return null
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
