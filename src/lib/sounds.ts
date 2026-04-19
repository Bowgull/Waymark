// Waymark in-session timer sounds.
//
// On iOS (Capacitor native) we delegate to the WaymarkAudio plugin, which
// plays pre-rendered .caf files through an AVAudioSession configured with
// `.playback + [.mixWithOthers, .duckOthers]`. That makes Spotify / other
// apps' audio duck briefly for each cue and restore on its own.
//
// On web (and any non-iOS runtime) we fall back to the original Web Audio
// synthesis so development in the browser is still audible.
//
// The baked .caf files are produced by `scripts/bakeTimerSounds.mjs` from the
// same parameters used in the Web Audio fallback below — rerun that script
// if you tweak any of the Web Audio constants so the two stay in sync.

import { isSessionAudioNative, playSessionSound } from './sessionAudio'

let audioCtx: AudioContext | null = null

function getCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext()
  }
  // iOS/mobile may suspend the context until a user gesture resumes it
  if (audioCtx.state === 'suspended') {
    audioCtx.resume()
  }
  return audioCtx
}

// Bell-like timbre using inharmonic partials (gives the metallic clang of a ring bell)
function playBell(frequency: number, decaySec: number, gainPeak: number = 0.7) {
  const ctx = getCtx()
  const now = ctx.currentTime

  // Inharmonic partials: fundamental + 2nd + 3rd
  // These ratios (1, 2.756, 5.404) are characteristic of metal percussion
  const partials = [1, 2.756, 5.404]
  const partialGains = [1, 0.5, 0.2]

  partials.forEach((ratio, i) => {
    const osc = ctx.createOscillator()
    const gainNode = ctx.createGain()

    osc.connect(gainNode)
    gainNode.connect(ctx.destination)

    osc.type = 'sine'
    osc.frequency.setValueAtTime(frequency * ratio, now)

    const peak = gainPeak * partialGains[i]
    gainNode.gain.setValueAtTime(0, now)
    gainNode.gain.linearRampToValueAtTime(peak, now + 0.002) // instant attack
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + decaySec)

    osc.start(now)
    osc.stop(now + decaySec)
  })
}

// Round start / rest over — GO signal
// High and sharp, cuts through headphone music
export function soundRoundStart() {
  if (isSessionAudioNative()) {
    void playSessionSound('round_start')
    return
  }
  playBell(880, 2.5, 0.75) // A5 — bright and hard
}

// Round end / rest start — STOP signal
// Same bell family, lower pitch so you know it's different
export function soundRoundEnd() {
  if (isSessionAudioNative()) {
    void playSessionSound('round_end')
    return
  }
  playBell(587, 3.0, 0.75) // D5 — lower, slightly warmer, more sustained
}

// Last 10 seconds of round — three rapid urgent pulses
// Square wave for harshness — you need to hear this clearly
export function soundFinishWarning() {
  if (isSessionAudioNative()) {
    void playSessionSound('finish_warning')
    return
  }
  const ctx = getCtx()
  const now = ctx.currentTime

  for (let i = 0; i < 3; i++) {
    const offset = i * 0.22
    const osc = ctx.createOscillator()
    const gainNode = ctx.createGain()

    osc.connect(gainNode)
    gainNode.connect(ctx.destination)

    osc.type = 'square'
    osc.frequency.setValueAtTime(1100, now + offset)

    gainNode.gain.setValueAtTime(0, now + offset)
    gainNode.gain.linearRampToValueAtTime(0.35, now + offset + 0.008)
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.18)

    osc.start(now + offset)
    osc.stop(now + offset + 0.2)
  }
}

// 10 seconds left in rest — two soft low tones
// Gentle heads-up, not a jolt — you're resting, not being attacked
export function soundRestWarning() {
  if (isSessionAudioNative()) {
    void playSessionSound('rest_warning')
    return
  }
  const ctx = getCtx()
  const now = ctx.currentTime

  for (let i = 0; i < 2; i++) {
    const offset = i * 0.4
    const osc = ctx.createOscillator()
    const gainNode = ctx.createGain()

    osc.connect(gainNode)
    gainNode.connect(ctx.destination)

    osc.type = 'sine'
    osc.frequency.setValueAtTime(330, now + offset) // E4 — low and calm

    gainNode.gain.setValueAtTime(0, now + offset)
    gainNode.gain.linearRampToValueAtTime(0.28, now + offset + 0.04)
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.5)

    osc.start(now + offset)
    osc.stop(now + offset + 0.55)
  }
}
