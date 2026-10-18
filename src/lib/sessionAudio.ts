// Waymark session-audio bridge
// Thin wrapper around the native WaymarkAudio plugin. Safe to call on web /
// non-iOS — methods no-op off platform. On iOS the plugin configures an
// AVAudioSession with .playback + [.mixWithOthers, .duckOthers]; this module
// keeps it active only around each cue, so other apps' audio (e.g. Spotify)
// ducks for the cue and comes back.

import { registerPlugin } from '@capacitor/core'
import { Capacitor } from '@capacitor/core'

export type SessionSoundName =
  | 'round_start'
  | 'round_end'
  | 'finish_warning'
  | 'rest_warning'

interface WaymarkAudioPlugin {
  activate(): Promise<void>
  play(options: { name: SessionSoundName }): Promise<void>
  deactivate(): Promise<void>
}

const native = registerPlugin<WaymarkAudioPlugin>('WaymarkAudio')
const isNative = Capacitor.getPlatform() === 'ios'

// Ducking only while a cue plays. The plugin's AVAudioSession uses
// .duckOthers, which ducks Spotify for as long as the session is ACTIVE; it
// used to be activated on mount and held for the whole bag session. Now
// play() activates it (the plugin lazily activates) and the session is
// released a moment after the last cue, which un-ducks the music
// (.notifyOthersOnDeactivation). The longest cue is ~3 s.
const CUE_RELEASE_MS = 3500
let releaseTimer: ReturnType<typeof setTimeout> | null = null

export function isSessionAudioNative(): boolean {
  return isNative
}

/** Kept for callers: no longer holds the session (that kept music ducked). */
export async function activateSessionAudio(): Promise<void> {
  // Intentionally empty: play() activates per cue.
}

export async function playSessionSound(name: SessionSoundName): Promise<void> {
  if (!isNative) return
  if (releaseTimer) clearTimeout(releaseTimer)
  releaseTimer = null
  try {
    await native.play({ name })
  } catch (err) {
    console.warn('[sessionAudio] play failed', name, err)
  } finally {
    releaseTimer = setTimeout(() => {
      releaseTimer = null
      void native.deactivate().catch(() => null)
    }, CUE_RELEASE_MS)
  }
}

export async function deactivateSessionAudio(): Promise<void> {
  if (!isNative) return
  if (releaseTimer) return // a cue is still playing; its release timer deactivates
  try {
    await native.deactivate()
  } catch (err) {
    console.warn('[sessionAudio] deactivate failed', err)
  }
}
