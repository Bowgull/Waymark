import { useCallback, useEffect, useRef, useState } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

import { RingTimer } from '@/components/RingTimer'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/Toast'
import { apiFetch } from '@/lib/api'
import { logger } from '@/lib/logger'
import { onePaceSvg } from '@/lib/markAssets'
import { soundRoundEnd } from '@/lib/sounds'
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
import { useWakeLock } from '@/lib/wakeLock'

import { SessionShell } from './SessionShell'
import { resolveRunMoment, type RunType } from './runMicrocopy'
import { useSessionLiveActivity, type LiveActivityConfig } from './useSessionLiveActivity'

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
}

export function RunSessionView({
  runSession,
  prescription,
  onComplete,
  onExit,
  inline = false,
  resume,
  onPersist,
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
      if (r.distanceKm != null) setDistance(String(Number(r.distanceKm.toFixed(2))))
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
    if (!isIndoor) {
      logger.sessionEvent('strava launch attempt', { runSessionId: runSession.id })
      tryOpenStrava(() => {
        logger.warn('session', 'strava not installed', { runSessionId: runSession.id }, 'Strava app not installed on device. Deep link canceled.')
        showToast('Strava not installed. Tap to get it from the App Store.', 'warning', {
          actionLabel: 'App Store',
          onAction: () => window.open(STRAVA_APP_STORE_URL, '_blank'),
        })
      })
    }
  }, [isIndoor, runSession.id, showToast])

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

  const narutoEpLabel = narutoEp != null ? `Naruto ep ${narutoEp}` : null

  const isZone2 = prescription?.runType === 'zone2'
  const runTypeLabel = prescription
    ? (RUN_TYPE_LABELS[prescription.runType] ?? 'Run')
    : 'Easy Run'
  const runDesc = prescription?.targetDesc
    ?? 'Keep it conversational pace. Focus on form: upright posture, relaxed shoulders, short strides.'
  const timerEstimate = prescription?.targetDurSec ?? 3600

  // Build inscription-style target segments
  const targetSegments: string[] = []
  if (prescription?.targetDurSec) {
    targetSegments.push(`${Math.round(prescription.targetDurSec / 60)} min`)
  }
  if (prescription?.targetDistKm) {
    targetSegments.push(`${prescription.targetDistKm} km`)
  }
  if (isZone2) {
    targetSegments.push(prescription.z2CeilingBpm ? `HR <= ${prescription.z2CeilingBpm}` : 'talk test')
    targetSegments.push('nasal breathing')
  }

  const runType = (prescription?.runType ?? undefined) as RunType | undefined
  const remaining = Math.max(0, timerEstimate - elapsed)
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
  const runLiveConfig: LiveActivityConfig | null =
    phase === 'running' && runStartedAtMs > 0
      ? {
          sessionType: 'run',
          sessionLabel: isIndoor ? indoorLabel : 'Run',
          state: {
            phase: 'active',
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

  const moment = resolveRunMoment({
    phase,
    runType,
    isIndoor,
    secondsRemaining: phase === 'running' ? remaining : undefined,
  })

  const counter =
    phase === 'logging'
      ? 'Log'
      : phase === 'running'
        ? 'Running'
        : prescription
          ? `Week ${prescription.weekNumber}`
          : undefined

  // ─── Body renderers per phase ────────────────────────────────

  const body =
    phase === 'ready' ? (
      <div className="mx-auto max-w-md animate-fade-in">
        <p className="font-cinzel text-[11px] uppercase tracking-[0.28em] text-gold/50">
          {isZone2 ? 'Morning Run' : prescription ? `Week ${prescription.weekNumber}` : 'Run'}
        </p>
        <h2 className="mt-1 text-display-lg text-foreground">{runTypeLabel}</h2>
        <p className="mt-3 text-sm leading-relaxed text-foreground/85">{runDesc}</p>

        {targetSegments.length > 0 && (
          <p className="mt-3 font-cinzel text-xs uppercase tracking-[0.22em] text-gold/60">
            {targetSegments.join(' \u00b7 ')}
          </p>
        )}

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={() => setIsIndoor(false)}
            className={`flex-1 rounded-md py-3 text-sm font-medium ${
              !isIndoor ? 'bg-teal-dark text-foreground' : 'bg-surface-light text-muted-foreground'
            }`}
          >
            Outdoor
          </button>
          <button
            onClick={() => setIsIndoor(true)}
            className={`flex-1 flex items-center justify-center gap-2 rounded-md py-3 text-sm font-medium ${
              isIndoor ? 'bg-teal-dark text-foreground' : 'bg-surface-light text-muted-foreground'
            }`}
          >
            <img src={onePaceSvg} alt="" className="h-5 w-5 object-contain" />
            Indoor
          </button>
        </div>

        {isIndoor && (
          <div className="mt-6 flex items-center gap-3">
            <button
              onClick={() => chooseMedia('one_pace')}
              className={`flex-1 rounded-md py-3 text-sm font-medium ${
                media === 'one_pace' ? 'bg-teal-dark text-foreground' : 'bg-surface-light text-muted-foreground'
              }`}
            >
              One Pace
            </button>
            <button
              onClick={() => chooseMedia('naruto')}
              className={`flex-1 rounded-md py-3 text-sm font-medium ${
                media === 'naruto' ? 'bg-teal-dark text-foreground' : 'bg-surface-light text-muted-foreground'
              }`}
            >
              Naruto
            </button>
          </div>
        )}

        {isIndoor && media === 'naruto' && (
          <div className="mt-6 flex flex-col items-center gap-4">
            {narutoEpLabel && (
              <p className="font-cinzel text-display-lg text-gold text-center">{narutoEpLabel}</p>
            )}
            <button
              onClick={() => window.open(NARUTO_NETFLIX_URL, '_blank')}
              className="flex w-full flex-col items-center gap-2 rounded-md border border-gold/15 bg-deep-forest px-6 py-8"
            >
              <span className="font-cinzel text-display-lg text-gold">Naruto</span>
              <span className="font-cinzel text-sm tracking-wider text-gold/70">
                Open in Netflix
              </span>
            </button>
          </div>
        )}

        {isIndoor && media === 'one_pace' && (
          <div className="mt-8 flex flex-col items-center gap-4">
            {(onePaceArc || onePaceEp) && (
              <p className="font-cinzel text-display-lg text-gold text-center">
                {[onePaceArc, onePaceEp ? `Ep ${onePaceEp}` : ''].filter(Boolean).join(' - ')}
              </p>
            )}
            <button
              onClick={() => window.open(ONEPACE_URL, '_blank')}
              className="flex w-full flex-col items-center gap-4 rounded-md border border-gold/15 bg-deep-forest px-6 py-8"
            >
              <img
                src={onePaceSvg}
                alt="One Pace"
                className="h-24 w-24 object-contain"
                style={{ mixBlendMode: 'screen' }}
              />
              <span className="font-cinzel text-sm tracking-wider text-gold/70">
                Open One Pace
              </span>
            </button>
          </div>
        )}
      </div>
    ) : phase === 'running' ? (
      <div className="mx-auto flex max-w-md flex-col items-center pt-6 animate-fade-in">
        <p className="font-cinzel text-[11px] uppercase tracking-[0.28em] text-gold/50">
          Running
        </p>
        <h2 className="mt-1 text-display-lg text-foreground">{runTypeLabel}</h2>
        {isIndoor && media === 'naruto' && narutoEpLabel && (
          <p className="mt-2 font-cinzel text-sm tracking-wider text-gold/70">{narutoEpLabel}</p>
        )}
        <div className="mt-8 rounded-2xl border border-gold/15 bg-deep-forest/60 p-5 shadow-[inset_0_1px_0_rgba(232,200,96,0.06)]">
          <RingTimer
            totalSeconds={timerEstimate}
            secondsRemaining={remaining}
            label="Running"
            accentColor="#1E8A68"
            size={240}
            isPaused={runPaused}
            onTogglePause={toggleRunPause}
          />
        </div>
        {!isIndoor && runSession.sessionId && (
          <button
            type="button"
            onClick={() => checkForStravaActivity()}
            disabled={checkingStrava}
            className="mt-6 flex min-h-[40px] items-center justify-center gap-2 rounded-md border border-gold/25 bg-near-black/40 px-4 py-2 text-xs font-medium text-gold/80 active:bg-near-black/70 disabled:opacity-50"
          >
            {checkingStrava ? 'Checking Strava…' : 'Pull run from Strava'}
          </button>
        )}
      </div>
    ) : narutoConfirm ? (
      // Naruto: one-tap confirm after the run is saved
      <div className="mx-auto max-w-md space-y-5 animate-fade-in">
        <div className="rounded-md border border-border bg-deep-forest p-4 text-center">
          <p className="text-sm font-medium text-teal">Naruto</p>
          <p className="mt-2 text-base text-foreground">
            Watched about {narutoConfirm.watched} episode{narutoConfirm.watched === 1 ? '' : 's'} ({narutoConfirm.minutes} min).
            {' '}Now on ep {narutoConfirm.proposed}?
          </p>
          {narutoConfirm.adjusting && (
            <div className="mx-auto mt-4 flex w-40 gap-1">
              <button
                type="button"
                onClick={() => stepNarutoProposed(-1)}
                className="min-h-[44px] w-10 shrink-0 rounded-md bg-border text-muted-foreground active:bg-muted"
              >
                -
              </button>
              <div className="flex min-h-[44px] flex-1 items-center justify-center rounded-md border border-border bg-surface text-lg text-foreground">
                {narutoConfirm.proposed}
              </div>
              <button
                type="button"
                onClick={() => stepNarutoProposed(1)}
                className="min-h-[44px] w-10 shrink-0 rounded-md bg-border text-muted-foreground active:bg-muted"
              >
                +
              </button>
            </div>
          )}
          {narutoArcForEp(narutoConfirm.proposed) && (
            <p className="mt-2 text-xs text-muted-foreground">{narutoArcForEp(narutoConfirm.proposed)}</p>
          )}
        </div>
      </div>
    ) : (
      // logging
      <div className="mx-auto max-w-md space-y-5 animate-fade-in">
        <div className="text-center">
          <h2 className="text-display-lg text-foreground">Log Your Run</h2>
          {fromStrava && (
            <p className="mt-2 font-cinzel text-[11px] uppercase tracking-[0.24em] text-gold/70">
              Pulled from Strava · review &amp; save
            </p>
          )}
        </div>

        {!isIndoor && runSession.sessionId && !fromStrava && (
          <button
            type="button"
            onClick={() => checkForStravaActivity()}
            disabled={checkingStrava}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md border border-gold/25 bg-near-black/40 px-4 py-2 text-sm font-medium text-gold/80 active:bg-near-black/70 disabled:opacity-50"
          >
            {checkingStrava ? 'Checking Strava…' : 'Pull run from Strava'}
          </button>
        )}

        <div className="flex gap-4">
          <div className="flex-1">
            <label className="text-label mb-1 block text-muted-foreground">Distance (km)</label>
            <input
              type="number"
              inputMode="decimal"
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
              placeholder="5.0"
              className="min-h-[44px] w-full rounded-md border border-border bg-surface px-3 py-2 text-center text-lg text-foreground placeholder-muted-foreground focus:border-teal-dark focus:outline-none"
            />
          </div>
          <div className="flex-1">
            <label className="text-label mb-1 block text-muted-foreground">Duration</label>
            <input
              type="text"
              inputMode="numeric"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="25:00"
              className="min-h-[44px] w-full rounded-md border border-border bg-surface px-3 py-2 text-center text-lg text-foreground placeholder-muted-foreground focus:border-teal-dark focus:outline-none"
            />
          </div>
        </div>

        <div className="flex gap-4">
          <div className="flex-1">
            <label className="text-label mb-1 block text-muted-foreground">Avg HR (bpm)</label>
            <input
              type="number"
              inputMode="numeric"
              value={avgHr}
              onChange={(e) => setAvgHr(e.target.value)}
              placeholder="138"
              className="min-h-[44px] w-full rounded-md border border-border bg-surface px-3 py-2 text-center text-lg text-foreground placeholder-muted-foreground focus:border-teal-dark focus:outline-none"
            />
          </div>
          <div className="flex-1">
            <label className="text-label mb-1 block text-muted-foreground">Max HR (bpm)</label>
            <input
              type="number"
              inputMode="numeric"
              value={maxHr}
              onChange={(e) => setMaxHr(e.target.value)}
              placeholder="162"
              className="min-h-[44px] w-full rounded-md border border-border bg-surface px-3 py-2 text-center text-lg text-foreground placeholder-muted-foreground focus:border-teal-dark focus:outline-none"
            />
          </div>
        </div>

        {isIndoor && media === 'one_pace' && (
          <div className="rounded-md border border-border bg-deep-forest p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <img src={onePaceSvg} alt="" className="h-6 w-6 object-contain" style={{ mixBlendMode: 'screen' }} />
                <p className="text-sm font-medium text-teal">One Pace</p>
              </div>
              <a
                href={ONEPACE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-teal/70 underline decoration-teal/30 active:text-teal"
              >
                onepace.net \u2197
              </a>
            </div>
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="text-label mb-1 block text-muted-foreground">Arc</label>
                <input type="text" value={onePaceArc} onChange={(e) => setOnePaceArc(e.target.value)}
                  placeholder="e.g. Water 7"
                  className="min-h-[44px] w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-foreground placeholder-muted-foreground focus:border-teal focus:outline-none" />
              </div>
              <div className="flex-1">
                <label className="text-label mb-1 block text-muted-foreground">Episode</label>
                <input type="text" value={onePaceEp} onChange={(e) => setOnePaceEp(e.target.value)}
                  placeholder="e.g. 3"
                  className="min-h-[44px] w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-foreground placeholder-muted-foreground focus:border-teal focus:outline-none" />
              </div>
            </div>
          </div>
        )}

        {showRunRealityMark && (
          <p className="font-cinzel text-[11px] uppercase tracking-[0.18em] text-gold/60">
            ◇ Short run noted
          </p>
        )}
      </div>
    )

  // ─── Footer per phase ────────────────────────────────────────

  const footer =
    phase === 'ready' ? (
      <Button
        onClick={startRun}
        size="lg"
        className="w-full"
        style={{ backgroundColor: '#1E8A68', color: '#020A08' }}
      >
        Start Run
      </Button>
    ) : phase === 'running' ? (
      <Button onClick={finishRun} size="lg" className="w-full">
        Finish Run
      </Button>
    ) : narutoConfirm ? (
      <div className="flex flex-col gap-2">
        <Button onClick={confirmNarutoEp} disabled={saving} size="lg" className="w-full">
          {saving ? 'Saving...' : `Yes, ep ${narutoConfirm.proposed}`}
        </Button>
        <div className="flex gap-2">
          {!narutoConfirm.adjusting && (
            <Button
              variant="outline"
              disabled={saving}
              className="flex-1"
              onClick={() => setNarutoConfirm(c => c && { ...c, adjusting: true })}
            >
              Adjust
            </Button>
          )}
          <Button variant="ghost" disabled={saving} className="flex-1" onClick={onComplete}>
            Skip
          </Button>
        </div>
      </div>
    ) : (
      <Button onClick={handleSave} disabled={saving} size="lg" className="w-full">
        {saving ? 'Saving...' : 'Save Run'}
      </Button>
    )

  if (inline) {
    return (
      <>
        <div className="flex flex-col gap-4">
          {body}
          <div className="mx-auto w-full max-w-md">{footer}</div>
        </div>
        <ToastContainer />
      </>
    )
  }

  return (
    <>
      <SessionShell
        sessionType="running"
        counter={counter}
        moment={moment}
        onExit={onExit}
        footer={footer}
      >
        {body}
      </SessionShell>
      <ToastContainer />
    </>
  )
}
