import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

import { CentredCard, FlapLabel, SessionIcon } from '@/design'
import { GrassZone, SessionButton, SessionFrame, TimerFace, type TimerTrack } from '@/components/timers'
import { useToast } from '@/components/ui/Toast'
import { apiFetch } from '@/lib/api'
import { logger } from '@/lib/logger'
import { soundRoundEnd, soundRoundStart } from '@/lib/sounds'
import { mediumHaptic } from '@/lib/haptics'
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

const STRAVA_APP_STORE_URL = 'https://apps.apple.com/app/strava/id426826309'
const STRAVA_DEEP_LINK = 'strava://record'

// Try to launch the Strava app. Uses a synthetic anchor click so Capacitor's
// WKWebView delegates the non-http scheme to UIApplication.open. Plain
// location.href assignments can be blocked by newer iOS WebView policies.
// If the page is still visible ~1.8s later, the scheme didn't resolve —
// offer an App Store link.
function tryOpenStrava(onNotInstalled: () => void) {
  const before = Date.now()
  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    window.clearTimeout(handle)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pagehide', onVisibility)
    window.removeEventListener('blur', onVisibility)
  }
  const handle = window.setTimeout(() => {
    const elapsed = Date.now() - before
    if (document.visibilityState === 'visible' && elapsed >= 1500) {
      onNotInstalled()
    }
    cleanup()
  }, 1800)
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') cleanup()
  }
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', onVisibility)
  window.addEventListener('blur', onVisibility)

  try {
    // Synthetic anchor click is the most reliable cross-webview way to hand
    // off a custom scheme to iOS.
    const a = document.createElement('a')
    a.href = STRAVA_DEEP_LINK
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  } catch {
    cleanup()
    onNotInstalled()
  }
}

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
  const [talkHr, setTalkHr] = useState(() => talkTestStart(Number(draft.avgHr ?? runSession.avgHr ?? NaN)))
  // Naruto: the saved next episode (settings), and the after-run confirm.
  const [narutoEp, setNarutoEp] = useState<number | null>(null)
  const [narutoConfirm, setNarutoConfirm] = useState<
    { watched: number; minutes: number; proposed: number; adjusting: boolean } | null
  >(null)
  const [stravaActivityId, setStravaActivityId] = useState<number | null>(
    runSession.stravaActivityId ?? null,
  )
  const [fromStrava, setFromStrava] = useState(false)
  const [checkingStrava, setCheckingStrava] = useState(false)
  const { show: showToast, ToastContainer } = useToast()
  const phaseRef = useRef<RunPhase>('ready')
  useEffect(() => { phaseRef.current = phase }, [phase])

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
      draft: { distance, duration, avgHr, maxHr, onePaceArc, onePaceEp },
    })
  }, [onPersist, phase, stopwatch, isIndoor, media, distance, duration, avgHr, maxHr, onePaceArc, onePaceEp])

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

  // Poll Strava and re-read our own run_sessions row. If Strava has finished
  // and our row has been upgraded with stravaActivityId, morph to logging
  // phase with values prefilled. User still confirms before we commit.
  const checkForStravaActivity = useCallback(async (opts?: { silent?: boolean }): Promise<boolean> => {
    if (!runSession.sessionId) return false
    if (checkingStrava) return false
    setCheckingStrava(true)
    try {
      // Best-effort poll: ingests any new runs from the last 48h.
      await apiFetch('/api/strava/poll-recent', { method: 'POST' }).catch(() => null)
      const data = await apiFetch<{
        runSession: {
          id: string
          distanceKm: number | null
          durationSec: number | null
          stravaActivityId: number | null
          attachmentStatus: string | null
          isIndoor: number
          avgHr: number | null
          maxHr: number | null
        } | null
      }>(`/api/sessions/${runSession.sessionId}/run-workout`)
      const r = data?.runSession
      if (!r || r.stravaActivityId == null) {
        if (!opts?.silent) showToast('No Strava activity yet. Still waiting.', 'info')
        return false
      }
      // Prefill from Strava values.
      if (r.distanceKm != null) setDistance(r.distanceKm.toFixed(2))
      if (r.durationSec != null) {
        const mins = Math.floor(r.durationSec / 60)
        const secs = r.durationSec % 60
        setDuration(secs > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : String(mins))
      }
      if (r.avgHr != null) setAvgHr(String(r.avgHr))
      if (r.maxHr != null) setMaxHr(String(r.maxHr))
      setStravaActivityId(r.stravaActivityId)
      setFromStrava(true)
      if (phaseRef.current === 'running') {
        setStopwatch(sw => (sw ? stopwatchPause(sw, Date.now()) : sw))
        setPhase('logging')
      }
      logger.sessionEvent('strava activity linked', {
        runSessionId: runSession.id,
        stravaActivityId: r.stravaActivityId,
      })
      if (!opts?.silent) showToast('Strava run pulled in. Review and save.', 'success')
      return true
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      logger.warn('session', 'strava poll failed', { message }, 'Strava activity poll failed. Run not auto-linked.')
      if (!opts?.silent) showToast('Could not reach Strava. Try again.', 'warning')
      return false
    } finally {
      setCheckingStrava(false)
    }
  }, [runSession.sessionId, runSession.id, checkingStrava, showToast])

  // Auto-retry on the Log screen: Strava takes a moment to finalize an
  // activity after the run ends, so poll every 10s for up to 2 min until we
  // link it or the user navigates away. Manual button stays as a fallback.
  useEffect(() => {
    if (phase !== 'logging') return
    if (isIndoor) return
    if (fromStrava) return
    if (!runSession.sessionId) return
    let handle: number | null = null
    let attempts = 0
    const MAX_ATTEMPTS = 12
    const tick = async () => {
      attempts += 1
      const found = await checkForStravaActivity({ silent: true })
      if (found || attempts >= MAX_ATTEMPTS) return
      handle = window.setTimeout(tick, 10_000)
    }
    handle = window.setTimeout(tick, 2_000)
    return () => {
      if (handle != null) window.clearTimeout(handle)
    }
  }, [phase, isIndoor, fromStrava, runSession.sessionId, checkForStravaActivity])

  // On app resume during an outdoor run, auto-check for the Strava activity.
  useEffect(() => {
    if (isIndoor) return
    let remove: (() => void) | null = null
    if (Capacitor.isNativePlatform()) {
      CapacitorApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive && phaseRef.current === 'running') {
          checkForStravaActivity({ silent: true })
        }
      }).then((handle) => { remove = () => handle.remove() })
    } else {
      const onVis = () => {
        if (document.visibilityState === 'visible' && phaseRef.current === 'running') {
          checkForStravaActivity({ silent: true })
        }
      }
      document.addEventListener('visibilitychange', onVis)
      remove = () => document.removeEventListener('visibilitychange', onVis)
    }
    return () => { if (remove) remove() }
  }, [isIndoor, checkForStravaActivity])

  const startRun = useCallback(() => {
    const now = Date.now()
    setStopwatch({ state: 'running', startedAtMs: now })
    setNowMs(now)
    setPhase('running')
    if (isIndoor) {
      window.open(media === 'naruto' ? NARUTO_NETFLIX_URL : ONEPACE_URL, '_blank')
    } else {
      logger.sessionEvent('strava launch attempt', { runSessionId: runSession.id })
      tryOpenStrava(() => {
        logger.warn('session', 'strava not installed', { runSessionId: runSession.id }, 'Strava app not installed on device. Deep link canceled.')
        showToast('Strava not installed. Tap to get it from the App Store.', 'warning', {
          actionLabel: 'App Store',
          onAction: () => window.open(STRAVA_APP_STORE_URL, '_blank'),
        })
      })
    }
  }, [isIndoor, media, runSession.id, showToast])

  function finishRun() {
    const now = Date.now()
    const finalSec = stopwatch ? Math.floor(stopwatchElapsedMs(stopwatch, now) / 1000) : elapsed
    setStopwatch(sw => (sw ? stopwatchPause(sw, now) : sw))
    const mins = Math.floor(finalSec / 60)
    const secs = finalSec % 60
    setDuration(secs > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : String(mins))
    setPhase('logging')
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
      await apiFetch(`/api/run-sessions/${runSession.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          distanceKm, durationSec, paceSecKm,
          isIndoor: isIndoor ? 1 : 0,
          onePaceArc: isIndoor && media === 'one_pace' && onePaceArc ? onePaceArc : undefined,
          onePaceEp: isIndoor && media === 'one_pace' && onePaceEp ? onePaceEp : undefined,
          avgHr: Number.isFinite(avgHrNum) ? avgHrNum : undefined,
          maxHr: Number.isFinite(maxHrNum) ? maxHrNum : undefined,
        }),
      })

      // If this run was pulled from Strava, lock the attachment and mark the
      // parent session completed. The user has now approved the values.
      if (stravaActivityId != null) {
        await apiFetch(`/api/strava/activity/${stravaActivityId}/confirm`, {
          method: 'POST',
        }).catch((err) => {
          logger.warn('session', 'strava confirm failed', {
            message: err instanceof Error ? err.message : String(err),
          }, 'POST /strava/activity/:id/confirm failed. Activity saved but not locked.')
        })
      }

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
  const runLiveConfig: LiveActivityConfig | null =
    phase === 'running' && runStartedAtMs > 0
      ? {
          sessionType: 'run',
          sessionLabel: isIndoor ? indoorLabel : 'Run',
          state: {
            phase: 'active',
            iconKey: runIconKey,
            label: isIndoor ? indoorLabel : runTypeLabel,
            detail: indoorDetail,
            startedAt: runStartedAtMs,
            endsAt: runPaused
              ? nowMs + remaining * 1000
              : runStartedAtMs + timerEstimate * 1000,
            isPaused: runPaused,
            pausedRemaining: runPaused ? remaining : undefined,
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
      // Lock-screen End leaves the session (still in progress, resumable).
      onExit?.()
    },
    // "Next →" from the lock screen: running → finish run (go to log).
    onAdvance: () => {
      if (phase === 'running') finishRun()
    },
  })

  // Ready and the log are boards over the forest (page 31); the running timer is on the dark ground.
  useEffect(() => {
    setWorldBackdrop(phase === 'running' ? null : 'clearing')
    return () => setWorldBackdrop(null)
  }, [phase])

  const runTitle = (prescription ? RUN_TITLES[prescription.runType] : null) ?? 'RUN'
  const icon = isZone2 || runSession.runType === 'zone2' ? 'zone2' as const : 'run' as const
  const targetMin = prescription?.targetDurSec ? Math.round(prescription.targetDurSec / 60) : null
  const narutoChip = isIndoor && media === 'naruto' && narutoEp != null ? `NARUTO EP ${narutoEp}` : null

  // ─── Running (page 19 "Run": the grass, one countdown, FINISH RUN) ───
  if (phase === 'running') {
    // Run-walk: the clock counts down the interval you are in (WALK teal like a rest, RUN gold),
    // with RUN 2/6 beside the title. Without intervals: the one countdown.
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
    const chips = [
      targetMin ? `${targetMin} MIN` : null,
      prescription?.targetDistKm ? `${prescription.targetDistKm} KM` : null,
      isZone2 ? (prescription?.z2CeilingBpm ? `HR <= ${prescription.z2CeilingBpm}` : 'TALK TEST') : null,
      isZone2 ? 'NASAL' : null,
      narutoChip,
    ].filter((c): c is string => !!c)
    const rounds = prescription?.runWalk?.rounds ?? 0
    return (
      <>
        <SessionFrame
          title={runTitle}
          count={seg ? runWalkCount(seg, rounds) : 'RUN'}
          onEnd={onExit}
          paused={runPaused}
          grass={<GrassZone track={track} kind={walking ? 'rest' : 'work'} heat={heat} onTap={toggleRunPause} onSkip={finishRun} />}
        >
          {chips.length > 0 && (
            <div className="wm-board" style={{ margin: '12px 14px 0' }}>
              <div className="ss-chips">{chips.map(c => <FlapLabel key={c} text={c} size="xs" />)}</div>
            </div>
          )}
          {seg
            ? <TimerFace seconds={shown} kind={walking ? 'rest' : 'work'} tone={walking ? 'teal' : undefined} heat={heat} label={walking ? runWalkWord(seg.kind) : workLabel(runWalkWord(seg.kind), shown)} labelTone={walking ? 'teal' : 'gold'} track={track} />
            : <TimerFace seconds={shown} kind="work" heat={heat} label={workLabel('RUNNING', remaining > 0 ? shown : 99)} labelTone="gold" track={track} />}
          <div className="tm-wide" style={{ marginTop: 16 }}>
            <SessionButton label="FINISH RUN" onClick={finishRun} />
          </div>
        </SessionFrame>
        <ToastContainer />
      </>
    )
  }

  // ─── Ready (page 31 "Zone 2 · ready, indoor" / "Progression · ready, outdoor") ───
  if (phase === 'ready') {
    const eyebrow = isZone2 ? 'Morning Run' : prescription ? `Week ${prescription.weekNumber}` : 'Run'
    const onePaceWhy = [onePaceArc, onePaceEp ? `Ep ${onePaceEp}` : ''].filter(Boolean).join(' · ') || 'onepace.net'
    return (
      <>
        <CentredCard label={`${runTypeLabel}, ready`} head={eyebrow} headRight={<SessionIcon kind={icon} size={34} />} onDismiss={onExit} className="ss-card">
          <div style={{ margin: '4px 0 10px' }}><FlapLabel text={runTypeLabel} size="lg" fit /></div>
          <div className="ss-rows">
            {targetMin != null && <TargetRow k="Time" v={`${targetMin} MIN`} />}
            {isZone2 && <TargetRow k="Heart rate" v={prescription?.z2CeilingBpm != null ? `UNDER ${prescription.z2CeilingBpm}` : 'TALK TEST'} tone="teal" />}
            {isZone2 && <TargetRow k="Breathing" v="NASAL" />}
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
          ) : (
            <p className="tm-note" style={{ margin: '10px 0 0' }}>START RUN also opens Strava.</p>
          )}
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

  // ─── Log your run (page 31 "Log your run") ───
  const linkable = !isIndoor && !!runSession.sessionId && !fromStrava
  return (
    <>
      <CentredCard label="Log your run" head="Log your run" headRight={fromStrava ? <FlapLabel text="FROM STRAVA" size="xs" tone="teal" /> : undefined} className="ss-card">
        {linkable && (
          <SessionButton label={checkingStrava ? 'CHECKING STRAVA' : 'PULL RUN FROM STRAVA'} disabled={checkingStrava} onClick={() => void checkForStravaActivity()} />
        )}
        <div className="ss-grid4">
          <ReadoutCell k="KM" value={distance} onChange={setDistance} inputMode="decimal" placeholder="5.0" />
          <ReadoutCell k="TIME" value={duration} onChange={setDuration} inputMode="numeric" placeholder="25:00" />
          <ReadoutCell k="AVG HR" value={avgHr} onChange={setAvgHr} inputMode="numeric" placeholder="138" />
          <ReadoutCell k="MAX HR" value={maxHr} onChange={setMaxHr} inputMode="numeric" placeholder="162" />
        </div>
        {!talkTest && <p className="tm-note" style={{ margin: '-2px 0 0' }}>Tap a number to change it.</p>}
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
        <div className="wm-btns" style={{ marginTop: 12 }}>
          <SessionButton label={saving ? 'SAVING' : 'SAVE RUN'} primary disabled={saving} onClick={() => void handleSave()} />
        </div>
      </CentredCard>
      <ToastContainer />
    </>
  )
}

function TargetRow({ k, v, tone }: { k: string; v: string; tone?: 'teal' }) {
  return (
    <div className="ss-row">
      <span className="wm-label ss-grow">{k}</span>
      <FlapLabel text={v} size="sm" tone={tone ?? 'ink'} />
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
