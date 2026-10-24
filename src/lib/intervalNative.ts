// The interval timer's native side (page 81): on the phone the run recorder's
// background-audio cue path (WaymarkRunRecorderPlugin, the same plugin that
// keeps an indoor run's cues on time with the screen off) keeps the timer's
// own clock, plays every beep and Poppy clip at its second, and moves the
// lock card at each part change and each orange edge while JS sleeps.
// Nothing is recorded or logged. Off the phone these calls do nothing: the
// web build plays the sounds itself.

import { Capacitor, registerPlugin } from '@capacitor/core'

import type { IntervalCue, IntervalPart } from './timers/intervalTimer'

export interface IntervalNativeStart {
  parts: Array<Pick<IntervalPart, 'ph' | 'len' | 'round'>>
  rounds: number
  cues: IntervalCue[]
  /** The timer's start, epoch ms. */
  startedAtMs: number
}

export interface IntervalNativeState {
  active: boolean
  /** Seconds run so far (pauses left out), in ms. */
  elapsedMs: number
  paused: boolean
  done: boolean
}

interface Plugin {
  intervalStart(o: IntervalNativeStart): Promise<void>
  intervalPause(): Promise<void>
  intervalResume(): Promise<void>
  intervalStop(): Promise<void>
  intervalState(): Promise<IntervalNativeState>
}

export const intervalIsNative = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'

let plugin: Plugin | null = null
const p = (): Plugin => (plugin ??= registerPlugin<Plugin>('WaymarkRunRecorder'))

export const intervalNative = {
  start: (o: IntervalNativeStart) => (intervalIsNative ? p().intervalStart(o).catch(() => {}) : Promise.resolve()),
  pause: () => (intervalIsNative ? p().intervalPause().catch(() => {}) : Promise.resolve()),
  resume: () => (intervalIsNative ? p().intervalResume().catch(() => {}) : Promise.resolve()),
  stop: () => (intervalIsNative ? p().intervalStop().catch(() => {}) : Promise.resolve()),
  state: async (): Promise<IntervalNativeState | null> => {
    if (!intervalIsNative) return null
    try { return await p().intervalState() } catch { return null }
  },
}
