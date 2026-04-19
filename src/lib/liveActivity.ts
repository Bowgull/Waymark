// Waymark Live Activity bridge
// Thin wrapper around the native WaymarkLiveActivity plugin.
// Safe to call on web/non-iOS — methods no-op off platform.

import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { Capacitor } from '@capacitor/core'

export type SessionType =
  | 'bag_work'
  | 'strength'
  | 'mobility'
  | 'skip_rope'
  | 'run'
  | 'recovery'

export type ActivityPhase = 'active' | 'rest' | 'hold' | 'complete'

export interface ActivityState {
  phase: ActivityPhase
  label: string          // "Round 3 of 12" | "Rest" | "Hold" | "Set 3 of 5"
  detail?: string        // combo name, exercise name, etc.
  endsAt: number         // epoch ms
  startedAt: number      // epoch ms
  isPaused: boolean
  pausedRemaining?: number // seconds remaining when paused
  completeMessage?: string // shown when phase === 'complete'
}

interface IsSupportedResult {
  supported: boolean
  iosVersion: string
}

interface StartResult {
  activityId: string
}

interface WaymarkLiveActivityPlugin {
  isSupported(): Promise<IsSupportedResult>
  start(options: {
    sessionType: SessionType
    sessionLabel: string
    state: ActivityState
  }): Promise<StartResult>
  update(options: { activityId?: string; state: ActivityState }): Promise<void>
  end(options: {
    activityId?: string
    state?: ActivityState
    dismissAfterMs?: number
  }): Promise<void>
  endAll(): Promise<void>
  addListener(
    eventName: 'pauseRequested',
    listener: () => void,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'resumeRequested',
    listener: (event: { endsAtMs?: number }) => void,
  ): Promise<PluginListenerHandle>
}

const native = registerPlugin<WaymarkLiveActivityPlugin>('WaymarkLiveActivity')

const isNative = Capacitor.getPlatform() === 'ios'

let cachedSupport: boolean | null = null
let currentActivityId: string | null = null

export async function isLiveActivitySupported(): Promise<boolean> {
  if (!isNative) return false
  if (cachedSupport !== null) return cachedSupport
  try {
    const { supported } = await native.isSupported()
    cachedSupport = supported
    return supported
  } catch {
    cachedSupport = false
    return false
  }
}

export async function startLiveActivity(
  sessionType: SessionType,
  sessionLabel: string,
  state: ActivityState,
): Promise<string | null> {
  if (!(await isLiveActivitySupported())) return null
  try {
    const { activityId } = await native.start({ sessionType, sessionLabel, state })
    currentActivityId = activityId
    return activityId
  } catch (err) {
    console.warn('[liveActivity] start failed', err)
    return null
  }
}

export async function updateLiveActivity(state: ActivityState): Promise<void> {
  if (!(await isLiveActivitySupported())) return
  if (!currentActivityId) return
  try {
    await native.update({ activityId: currentActivityId, state })
  } catch (err) {
    console.warn('[liveActivity] update failed', err)
  }
}

export async function endLiveActivity(
  finalState?: ActivityState,
  dismissAfterMs = 0,
): Promise<void> {
  if (!(await isLiveActivitySupported())) return
  if (!currentActivityId) return
  try {
    await native.end({
      activityId: currentActivityId,
      state: finalState,
      dismissAfterMs,
    })
  } catch (err) {
    console.warn('[liveActivity] end failed', err)
  } finally {
    currentActivityId = null
  }
}

export async function endAllLiveActivities(): Promise<void> {
  if (!(await isLiveActivitySupported())) return
  try {
    await native.endAll()
  } catch (err) {
    console.warn('[liveActivity] endAll failed', err)
  } finally {
    currentActivityId = null
  }
}

export async function onPauseRequested(
  handler: () => void,
): Promise<PluginListenerHandle | null> {
  if (!isNative) return null
  try {
    return await native.addListener('pauseRequested', handler)
  } catch {
    return null
  }
}

export async function onResumeRequested(
  handler: (endsAtMs: number | undefined) => void,
): Promise<PluginListenerHandle | null> {
  if (!isNative) return null
  try {
    return await native.addListener('resumeRequested', (event) => {
      handler(event.endsAtMs)
    })
  } catch {
    return null
  }
}
