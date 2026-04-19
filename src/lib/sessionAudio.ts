// Waymark session-audio bridge
// Thin wrapper around the native WaymarkAudio plugin. Safe to call on web /
// non-iOS — methods no-op off platform. On iOS the plugin configures an
// AVAudioSession with .playback + [.mixWithOthers, .duckOthers], so in-session
// cues duck other apps' audio (e.g. Spotify) briefly then restore.

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

let activated = false

export function isSessionAudioNative(): boolean {
  return isNative
}

export async function activateSessionAudio(): Promise<void> {
  if (!isNative) return
  if (activated) return
  try {
    await native.activate()
    activated = true
  } catch (err) {
    console.warn('[sessionAudio] activate failed', err)
  }
}

export async function playSessionSound(name: SessionSoundName): Promise<void> {
  if (!isNative) return
  try {
    await native.play({ name })
  } catch (err) {
    console.warn('[sessionAudio] play failed', name, err)
  }
}

export async function deactivateSessionAudio(): Promise<void> {
  if (!isNative) return
  if (!activated) return
  try {
    await native.deactivate()
  } catch (err) {
    console.warn('[sessionAudio] deactivate failed', err)
  } finally {
    activated = false
  }
}
