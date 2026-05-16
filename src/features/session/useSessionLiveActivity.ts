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
  onPause?: () => void
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

  // Register pause/resume/restart/end listeners once per mount.
  useEffect(() => {
    let pauseHandle: PluginListenerHandle | null = null
    let resumeHandle: PluginListenerHandle | null = null
    let restartHandle: PluginListenerHandle | null = null
    let endHandle: PluginListenerHandle | null = null
    let completeSetHandle: PluginListenerHandle | null = null
    let startHoldHandle: PluginListenerHandle | null = null
    let advanceHandle: PluginListenerHandle | null = null

    void onPauseRequested(() => {
      handlersRef.current.onPause?.()
    }).then(h => { pauseHandle = h })

    void onResumeRequested((endsAtMs) => {
      handlersRef.current.onResume?.(endsAtMs)
    }).then(h => { resumeHandle = h })

    void onRestartRequested(() => {
      handlersRef.current.onRestart?.()
    }).then(h => { restartHandle = h })

    void onEndRequested(() => {
      handlersRef.current.onEnd?.()
    }).then(h => { endHandle = h })

    void onCompleteSetRequested(() => {
      handlersRef.current.onCompleteSet?.()
    }).then(h => { completeSetHandle = h })

    void onStartHoldRequested(() => {
      handlersRef.current.onStartHold?.()
    }).then(h => { startHoldHandle = h })

    void onAdvanceRequested(() => {
      handlersRef.current.onAdvance?.()
    }).then(h => { advanceHandle = h })

    return () => {
      void pauseHandle?.remove()
      void resumeHandle?.remove()
      void restartHandle?.remove()
      void endHandle?.remove()
      void completeSetHandle?.remove()
      void startHoldHandle?.remove()
      void advanceHandle?.remove()
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
