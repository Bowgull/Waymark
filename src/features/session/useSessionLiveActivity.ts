import { useEffect, useRef } from 'react'
import type { PluginListenerHandle } from '@capacitor/core'

import {
  startLiveActivity,
  updateLiveActivity,
  onPauseRequested,
  onResumeRequested,
  onRestartRequested,
  onEndRequested,
  onCompleteSetRequested,
  onStartHoldRequested,
  onAdvanceRequested,
  type ActivityState,
  type SessionType,
} from '@/lib/liveActivity'

export interface LiveActivityConfig {
  sessionType: SessionType
  sessionLabel: string
  state: ActivityState
}

interface Handlers {
  /** `pausedRemainingMs`: what the lock screen showed at the tap, when known. */
  onPause?: (pausedRemainingMs: number | undefined) => void
  onResume?: (newEndsAtMs: number | undefined) => void
  /** Fired when the user taps Restart on the Live Activity. Restart the
   *  current phase (round, rest, hold, interval) from full duration. */
  onRestart?: () => void
  /** Fired when the user confirms End on the Live Activity. Tear down
   *  the session (typically calling the view's onExit). */
  onEnd?: () => void
  /** Fired when the user taps Complete Set on an exercise-phase
   *  Live Activity. Handler reads current weight/reps from its UI state
   *  and runs the normal set-complete flow. */
  onCompleteSet?: () => void
  /** Fired when the user taps Start Hold on a mobility "ready" Live
   *  Activity. Handler begins the next hold timer. */
  onStartHold?: () => void
  /** Fired when the user taps the universal "Next →" / "Done →" /
   *  "Skip →" button on any timer phase (hold, rest, active). Handler
   *  advances the session to the next natural step. */
  onAdvance?: () => void
}

/**
 * Declarative Live Activity driver.
 *
 * Morph-only invariant: engines start or update via this hook; they never
 * end on unmount. A workout has exactly one Live Activity from first engine
 * mount through session completion. Cross-engine transitions (mobility →
 * run → mobility in Foundation Run, round ↔ rest in bag work, exercise ↔
 * rest in strength) morph the existing LA via update() rather than tearing
 * it down and spawning a new one.
 *
 * Pass a config to start/update. Passing null stops pushing updates but
 * does NOT end the LA — only WorkoutPage (the session controller) ends
 * the LA explicitly at session completion.
 *
 * Pause/resume handlers are registered once and fire when the user
 * taps the widget buttons (Live Activity → NotificationCenter → JS).
 */
export function useSessionLiveActivity(
  config: LiveActivityConfig | null,
  handlers: Handlers = {},
) {
  const startedRef = useRef(false)
  const lastStateKey = useRef<string>('')
  const handlersRef = useRef(handlers)

  useEffect(() => {
    handlersRef.current = handlers
  }, [handlers])

  // Start / update — react to config changes. Null config is a no-op.
  useEffect(() => {
    if (!config) return

    const key = stateKey(config.state)

    if (!startedRef.current) {
      startedRef.current = true
      lastStateKey.current = key
      void startLiveActivity(config.sessionType, config.sessionLabel, config.state)
      return
    }

    if (key !== lastStateKey.current) {
      lastStateKey.current = key
      void updateLiveActivity(config.state)
    }
  }, [config])

  // Register pause/resume/restart/end listeners once per mount. A handle
  // that resolves after unmount is removed at once (it used to leak).
  useEffect(() => {
    let cancelled = false
    const handles: PluginListenerHandle[] = []
    const keep = (h: PluginListenerHandle | null) => {
      if (!h) return
      if (cancelled) void h.remove()
      else handles.push(h)
    }

    void onPauseRequested((pausedRemainingMs) => {
      handlersRef.current.onPause?.(pausedRemainingMs)
    }).then(keep)
    void onResumeRequested((endsAtMs) => {
      handlersRef.current.onResume?.(endsAtMs)
    }).then(keep)
    void onRestartRequested(() => {
      handlersRef.current.onRestart?.()
    }).then(keep)
    void onEndRequested(() => {
      handlersRef.current.onEnd?.()
    }).then(keep)
    void onCompleteSetRequested(() => {
      handlersRef.current.onCompleteSet?.()
    }).then(keep)
    void onStartHoldRequested(() => {
      handlersRef.current.onStartHold?.()
    }).then(keep)
    void onAdvanceRequested(() => {
      handlersRef.current.onAdvance?.()
    }).then(keep)

    return () => {
      cancelled = true
      for (const h of handles) void h.remove()
    }
  }, [])
}

function stateKey(s: ActivityState): string {
  return [
    s.phase,
    s.label,
    s.detail ?? '',
    Math.round(s.endsAt),
    Math.round(s.startedAt),
    s.isPaused ? '1' : '0',
    s.pausedRemaining != null ? Math.round(s.pausedRemaining) : '',
    s.completeMessage ?? '',
    s.exerciseName ?? '',
  ].join('|')
}
