import { useCallback, useEffect, useRef, useState } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

import { RingTimer } from '@/components/RingTimer'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/Toast'
import { apiFetch } from '@/lib/api'
import { logger } from '@/lib/logger'
import { onePaceSvg } from '@/lib/markAssets'

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
}

type RunPhase = 'ready' | 'running' | 'logging'

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
}

export function RunSessionView({
  runSession,
  prescription,
  onComplete,
  onExit,
  inline = false,
}: RunSessionViewProps) {
  const [phase, setPhase] = useState<RunPhase>('ready')
  const [isIndoor, setIsIndoor] = useState(runSession.isIndoor === 1)
  const [elapsed, setElapsed] = useState(0)
  const [runPaused, setRunPaused] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedAtRef = useRef<number>(0)
  const pausedElapsedRef = useRef<number>(0)

  const [distance, setDistance] = useState('')
  const [duration, setDuration] = useState('')
  const [onePaceArc, setOnePaceArc] = useState(runSession.onePaceArc ?? '')
  const [onePaceEp, setOnePaceEp] = useState(runSession.onePaceEp ?? '')
  const [saving, setSaving] = useState(false)
  const [stravaActivityId, setStravaActivityId] = useState<number | null>(
    runSession.stravaActivityId ?? null,
  )
  const [fromStrava, setFromStrava] = useState(false)
  const [checkingStrava, setCheckingStrava] = useState(false)
  const { show: showToast, ToastContainer } = useToast()
  const phaseRef = useRef<RunPhase>('ready')
  useEffect(() => { phaseRef.current = phase }, [phase])

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  // Auto-fill One Pace arc/ep from settings if not already set
  useEffect(() => {
    if (runSession.onePaceArc || runSession.onePaceEp) return
    apiFetch<{ onePaceArc?: string | null; onePaceEp?: string | null } | null>('/api/settings')
      .then((s) => {
        if (s?.onePaceArc) setOnePaceArc(s.onePaceArc)
        if (s?.onePaceEp) setOnePaceEp(s.onePaceEp)
      })
      .catch((e) => {
        const message = e instanceof Error ? e.message : String(e)
        logger.warn('system', 'settings autofill load failed', { message })
      })
  }, [])

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
      setStravaActivityId(r.stravaActivityId)
      setFromStrava(true)
      if (phaseRef.current === 'running') {
        if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
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
      logger.warn('session', 'strava poll failed', { message })
      if (!opts?.silent) showToast('Could not reach Strava. Try again.', 'warning')
      return false
    } finally {
      setCheckingStrava(false)
    }
  }, [runSession.sessionId, runSession.id, checkingStrava, showToast])

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
    startedAtRef.current = Date.now()
    pausedElapsedRef.current = 0
    setRunPaused(false)
    setPhase('running')
    intervalRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000))
    }, 500)
    if (!isIndoor) {
      logger.sessionEvent('strava launch attempt', { runSessionId: runSession.id })
      tryOpenStrava(() => {
        logger.warn('session', 'strava not installed', { runSessionId: runSession.id })
        showToast('Strava not installed. Tap to get it from the App Store.', 'warning', {
          actionLabel: 'App Store',
          onAction: () => window.open(STRAVA_APP_STORE_URL, '_blank'),
        })
      })
    }
  }, [isIndoor, runSession.id, showToast])

  function finishRun() {
    if (intervalRef.current) clearInterval(intervalRef.current)
    const mins = Math.floor(elapsed / 60)
    const secs = elapsed % 60
    setDuration(secs > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : String(mins))
    setPhase('logging')
  }

  async function handleSave() {
    setSaving(true)
    let durationSec: number | undefined
    if (duration) {
      const parts = duration.split(':')
      durationSec = parts.length === 2
        ? parseInt(parts[0]) * 60 + parseInt(parts[1])
        : parseInt(parts[0]) * 60
    }
    const distanceKm = distance ? parseFloat(distance) : undefined
    const paceSecKm = distanceKm && durationSec ? Math.round(durationSec / distanceKm) : undefined

    try {
      await apiFetch(`/api/run-sessions/${runSession.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          distanceKm, durationSec, paceSecKm,
          isIndoor: isIndoor ? 1 : 0,
          onePaceArc: isIndoor && onePaceArc ? onePaceArc : undefined,
          onePaceEp: isIndoor && onePaceEp ? onePaceEp : undefined,
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
          })
        })
      }

      if (isIndoor && onePaceEp) {
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
    targetSegments.push('HR 130-145')
    targetSegments.push('nasal breathing')
  }

  const runType = (prescription?.runType ?? undefined) as RunType | undefined
  const remaining = Math.max(0, timerEstimate - elapsed)

  const toggleRunPause = useCallback(() => {
    if (phase !== 'running') return
    if (runPaused) {
      startedAtRef.current = Date.now() - pausedElapsedRef.current * 1000
      setRunPaused(false)
      if (intervalRef.current) clearInterval(intervalRef.current)
      intervalRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000))
      }, 500)
    } else {
      pausedElapsedRef.current = Math.floor((Date.now() - startedAtRef.current) / 1000)
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      setRunPaused(true)
    }
  }, [phase, runPaused])

  // Live Activity for run. Indoor surfaces the One Piece arc/episode so a
  // glance at the Dynamic Island shows what's playing, not "Zone 2 · Indoor".
  const runLiveConfig: LiveActivityConfig | null =
    phase === 'running' && startedAtRef.current > 0
      ? {
          sessionType: 'run',
          sessionLabel: isIndoor ? 'One Piece' : 'Run',
          state: {
            phase: 'active',
            label: isIndoor
              ? (onePaceArc || 'One Piece')
              : runTypeLabel,
            detail: isIndoor
              ? (onePaceEp ? `Ep ${onePaceEp}` : undefined)
              : 'Outdoor',
            startedAt: startedAtRef.current,
            endsAt: runPaused
              ? Date.now() + remaining * 1000
              : startedAtRef.current + timerEstimate * 1000,
            isPaused: runPaused,
            pausedRemaining: runPaused ? remaining : undefined,
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
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
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
          <div className="mt-8 flex flex-col items-center gap-4">
            {(onePaceArc || onePaceEp) && (
              <p className="font-cinzel text-display-lg text-gold text-center">
                {[onePaceArc, onePaceEp ? `Ep ${onePaceEp}` : ''].filter(Boolean).join(' - ')}
              </p>
            )}
            <button
              onClick={() => window.open('https://onepace.net', '_blank')}
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

        {isIndoor && (
          <div className="rounded-md border border-border bg-deep-forest p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <img src={onePaceSvg} alt="" className="h-6 w-6 object-contain" style={{ mixBlendMode: 'screen' }} />
                <p className="text-sm font-medium text-teal">One Pace</p>
              </div>
              <a
                href="https://onepace.net"
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
