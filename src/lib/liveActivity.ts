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

export type ActivityPhase = 'active' | 'rest' | 'hold' | 'complete' | 'exercise' | 'ready'

export interface ActivityState {
  phase: ActivityPhase
  label: string          // "Round 3 of 12" | "Rest" | "Hold" | "Set 3 of 5"
  detail?: string        // combo name, exercise name, etc.
  endsAt: number         // epoch ms (ignored when phase === 'exercise')
  startedAt: number      // epoch ms (ignored when phase === 'exercise')
  isPaused: boolean
  pausedRemaining?: number // seconds remaining when paused
  completeMessage?: string // shown when phase === 'complete'
  // Exercise-phase (phase === 'exercise'). Kept intentionally minimal:
  // the lock screen shows exercise name + set counter only. Weight, plate
  // math, PR chrome live inside the app.
  exerciseName?: string    // e.g. "Back Squat"
}

interface IsSupportedResult {
  supported: boolean
  iosVersion: string
}

interface StartResult {
  activityId: string
}

interface GetCurrentResult {
  activityId?: string
  sessionType?: SessionType
  sessionLabel?: string
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
  getCurrent(): Promise<GetCurrentResult>
  addListener(
    eventName: 'pauseRequested',
    listener: () => void,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'resumeRequested',
    listener: (event: { endsAtMs?: number }) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'restartRequested',
    listener: () => void,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'endRequested',
    listener: () => void,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'completeSetRequested',
    listener: () => void,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'startHoldRequested',
    listener: () => void,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'advanceRequested',
    listener: () => void,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'activityEnded',
    listener: (event: { activityId: string }) => void,
  ): Promise<PluginListenerHandle>
}

const native = registerPlugin<WaymarkLiveActivityPlugin>('WaymarkLiveActivity')

const isNative = Capacitor.getPlatform() === 'ios'

let cachedSupport: boolean | null = null
let currentActivityId: string | null = null
// sessionType attached to the currently-tracked LA. Tracked so we can detect
// a mismatch on startLiveActivity (e.g. stale bag_work LA adopted from a
// crashed prior session, now the user starts a skip_rope session — we must
// end the old LA rather than morph, because ActivityAttributes are immutable
// and the old "Bag Work" label would be stuck on the new session's LA).
let currentSessionType: SessionType | null = null
let adoptionAttempted = false

// Morph-only invariant: a workout has exactly one Live Activity from start
// to finish. Engine views mount/unmount as phases change (mobility advancing
// exercises, bag round↔rest) but they never end the LA. They call
// startLiveActivity() which morphs in place when one is already live.
// Only WorkoutPage ends the LA — once, at session completion.

// Auto-clear cached id when the plugin reports the underlying activity was
// ended externally (user dismissed from Notification Center, OS invalidated,
// or ConfirmEndIntent killed it intrinsically). Registered once at module
// load so future calls to startLiveActivity won't try to morph a dead id.
if (isNative) {
  void native
    .addListener('activityEnded', (event) => {
      if (!event.activityId || event.activityId === currentActivityId) {
        currentActivityId = null
        currentSessionType = null
      }
    })
    .catch(() => null)
}

// First-op adoption: on cold launch the plugin picks up any pre-existing
// LA into its native cache, but JS starts with currentActivityId=null. Pull
// the native cache into JS once so the first startLiveActivity() morphs the
// existing LA instead of spawning a duplicate.
async function ensureAdopted(): Promise<void> {
  if (adoptionAttempted || !isNative) return
  adoptionAttempted = true
  try {
    const result = await native.getCurrent()
    if (result?.activityId) {
      currentActivityId = result.activityId
      currentSessionType = (result.sessionType as SessionType | undefined) ?? null
    }
  } catch {
    // getCurrent not implemented (older plugin) or native error — ignore.
  }
}

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
  await ensureAdopted()

  // Stale-attribute guard: ActivityAttributes (sessionType + sessionLabel)
  // are immutable on a running LA, so morphing a prior session's LA onto a
  // new session leaves the wrong "Bag Work" / "Mobility" label stuck on the
  // lock screen forever. If the adopted or cached LA is for a different
  // session type than the one we're starting, end it first and fall through
  // to spawn a fresh LA with the correct attributes.
  if (
    currentActivityId &&
    currentSessionType &&
    currentSessionType !== sessionType
  ) {
    const staleId = currentActivityId
    currentActivityId = null
    currentSessionType = null
    try {
      await native.end({ activityId: staleId })
    } catch (err) {
      console.warn('[liveActivity] stale LA end failed', err)
    }
  }

  // Morph-preferring: if an LA already exists for this same sessionType,
  // update in place rather than spawning a new one. Per the workout-level
  // morph invariant, attributes stay fixed for a given session; only the
  // ContentState morphs across phases.
  if (currentActivityId) {
    try {
      await native.update({ activityId: currentActivityId, state })
      return currentActivityId
    } catch (err) {
      console.warn('[liveActivity] in-place morph failed, restarting', err)
      currentActivityId = null
      currentSessionType = null
    }
  }

  try {
    const { activityId } = await native.start({ sessionType, sessionLabel, state })
    currentActivityId = activityId
    currentSessionType = sessionType
    return activityId
  } catch (err) {
    console.warn('[liveActivity] start failed', err)
    return null
  }
}

export async function updateLiveActivity(state: ActivityState): Promise<void> {
  if (!(await isLiveActivitySupported())) return
  await ensureAdopted()
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
  await ensureAdopted()
  if (!currentActivityId) return
  const activityId = currentActivityId
  currentActivityId = null
  currentSessionType = null
  try {
    await native.end({ activityId, state: finalState, dismissAfterMs })
  } catch (err) {
    console.warn('[liveActivity] end failed', err)
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
    currentSessionType = null
  }
}

export function getCurrentLiveActivityId(): string | null {
  return currentActivityId
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

export async function onRestartRequested(
  handler: () => void,
): Promise<PluginListenerHandle | null> {
  if (!isNative) return null
  try {
    return await native.addListener('restartRequested', handler)
  } catch {
    return null
  }
}

export async function onEndRequested(
  handler: () => void,
): Promise<PluginListenerHandle | null> {
  if (!isNative) return null
  try {
    return await native.addListener('endRequested', handler)
  } catch {
    return null
  }
}

export async function onCompleteSetRequested(
  handler: () => void,
): Promise<PluginListenerHandle | null> {
  if (!isNative) return null
  try {
    return await native.addListener('completeSetRequested', handler)
  } catch {
    return null
  }
}

export async function onStartHoldRequested(
  handler: () => void,
): Promise<PluginListenerHandle | null> {
  if (!isNative) return null
  try {
    return await native.addListener('startHoldRequested', handler)
  } catch {
    return null
  }
}

export async function onAdvanceRequested(
  handler: () => void,
): Promise<PluginListenerHandle | null> {
  if (!isNative) return null
  try {
    return await native.addListener('advanceRequested', handler)
  } catch {
    return null
  }
}
