import { useEffect, useRef } from 'react'
import type { PluginListenerHandle } from '@capacitor/core'

import {
  startLiveActivity,
  updateLiveActivity,
  endLiveActivity,
  onPauseRequested,
  onResumeRequested,
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
}

/**
 * Declarative Live Activity driver.
 *
 * Pass a config to start/update the activity; pass null to end it.
 * Pause/resume handlers are registered once and fire when the user
 * taps the widget buttons (Live Activity → NotificationCenter → JS).
 *
 * State is diffed shallowly, so passing the same values on every render
 * won't spam the native side.
 */
export function useSessionLiveActivity(
  config: LiveActivityConfig | null,
  handlers: Handlers = {},
) {
  const startedRef = useRef(false)
  const lastStateKey = useRef<string>('')
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  // Start / update / end — react to config changes.
  useEffect(() => {
    if (!config) {
      if (startedRef.current) {
        startedRef.current = false
        lastStateKey.current = ''
        void endLiveActivity()
      }
      return
    }

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

  // Clean up on unmount.
  useEffect(() => {
    return () => {
      if (startedRef.current) {
        startedRef.current = false
        void endLiveActivity()
      }
    }
  }, [])

  // Register pause/resume listeners once per mount.
  useEffect(() => {
    let pauseHandle: PluginListenerHandle | null = null
    let resumeHandle: PluginListenerHandle | null = null

    void onPauseRequested(() => {
      handlersRef.current.onPause?.()
    }).then(h => { pauseHandle = h })

    void onResumeRequested((endsAtMs) => {
      handlersRef.current.onResume?.(endsAtMs)
    }).then(h => { resumeHandle = h })

    return () => {
      void pauseHandle?.remove()
      void resumeHandle?.remove()
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
  ].join('|')
}
