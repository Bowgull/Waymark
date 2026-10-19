// The session timers' look, pure (no DOM): pages 19 and 31 and design-decisions.md
// "Sessions (page 19)" + "Added 2026-10-18 (later)".
//
// - Work timers (bag round, rope, run) heat up in their last 10 s: yellow 10–7,
//   orange 6–4, red 3–0, across the digits, the FINISH label and the grass; the
//   clock grows a touch (1.06) at red.
// - Holds and rest stay calm teal; from 5 s out the clock eases into a swell,
//   brightens and breathes, and the grass glows.
// - Digits are four flap tiles MM:SS; each flips only through digits, the short way.
// - Combos are strikes joined by ›; each combo keeps one letter (A, B, C…) for the session.

export type TimerKind = 'work' | 'hold' | 'rest'
export type Heat = 'hy' | 'ho' | 'hr'

/** The heat band of a work timer at `secLeft` (whole seconds, as shown). Null outside the last 10 s. */
export function heatFor(secLeft: number, kind: TimerKind = 'work'): Heat | null {
  if (kind !== 'work') return null
  if (!Number.isFinite(secLeft) || secLeft > 10 || secLeft < 0) return null
  return secLeft <= 3 ? 'hr' : secLeft <= 6 ? 'ho' : 'hy'
}

/** Page 19's heat colours for the grass (RGB), by band. */
export const HEAT_RGB: Record<Heat, [number, number, number]> = {
  hy: [226, 192, 76],
  ho: [224, 138, 60],
  hr: [208, 72, 58],
}

/** The clock grows slightly at red (page 19: `.phone.heat-hr .clock { transform: scale(1.06) }`). */
export const HEAT_RED_SCALE = 1.06

/**
 * The calm "nearly there" swell of holds and rest (page 19 `wire()`): 0 until 5 s
 * out, then a smoothstep to 1 over 1.2 s. `remainingSec` is the exact time left.
 */
export function swellK(remainingSec: number, kind: TimerKind): number {
  if (kind === 'work') return 0
  if (!(remainingSec > 0)) return 0
  const raw = Math.min(1, Math.max(0, (5 - remainingSec) / 1.2))
  return raw * raw * (3 - 2 * raw)
}

/** The swell's breath (0.92–1.0 of k) at time `nowMs`: page 19's `0.92 + 0.08 * sin(t / 700)`. */
export function swellBreath(k: number, nowMs: number): number {
  return k * (0.92 + 0.08 * Math.sin(nowMs / 700))
}

/** Clock scale, brightness and glow for a breath value `br` (page 19). */
export function swellStyle(br: number): { scale: number; brightness: number; glowPx: number; glowAlpha: number } {
  return { scale: 1 + 0.08 * br, brightness: 1 + 0.38 * br, glowPx: 18 * br, glowAlpha: 0.55 * br }
}

/** The four clock digits MMSS for whole seconds (negative shows 00:00; 100+ minutes keep the last two). */
export function clockDigits(sec: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0))
  const mm = Math.floor(s / 60) % 100
  return String(mm).padStart(2, '0') + String(s % 60).padStart(2, '0')
}

/** Whole seconds shown for a countdown with `remainingMs` left: rounds up, so 0 shows only at the end. */
export function shownSeconds(remainingMs: number): number {
  return Math.max(0, Math.ceil(remainingMs / 1000))
}

/** A countdown as the grass and the clock see it: running (an end time) or held (what is left). */
export interface TimerTrack {
  durationSec: number
  /** Running: the wall-clock end. Null when paused or not started. */
  endsAtMs: number | null
  /** Paused / not started: what is left (ms). */
  remainingMs: number
}

export function trackRemainingMs(track: TimerTrack, nowMs = Date.now()): number {
  return track.endsAtMs != null ? track.endsAtMs - nowMs : track.remainingMs
}

/** How far through a countdown (0..1) — the lit part of the grass. */
export function progressOf(remainingMs: number, durationSec: number): number {
  if (!(durationSec > 0)) return 0
  return Math.min(1, Math.max(0, 1 - remainingMs / (durationSec * 1000)))
}

/** The phase word of a work timer: its running word, FINISH in the last 10 s. */
export function workLabel(running: string, secLeft: number): string {
  return heatFor(secLeft) ? 'FINISH' : running
}

// ─── the swipe-up skip on the grass ──────────────────────────

/** How far a drag up the grass has pulled (0..1): a full pull is 45% of the grass height (page 19). */
export function pullAmount(startY: number, y: number, height: number): number {
  if (!(height > 0)) return 0
  return Math.max(0, Math.min(1, (startY - y) / (height * 0.45)))
}

/** What a finger lift means: a full pull skips; a drag that went up more than 40 px is a let-go; else a tap pauses. */
export function releaseAction(pull: number, dy: number): 'skip' | 'none' | 'tap' {
  if (pull >= 1) return 'skip'
  if (dy < -40) return 'none'
  return 'tap'
}

/** The × end button: held this long, it ends (a clay bar fills along its foot). */
export const END_HOLD_MS = 1500

/**
 * After the hold, the phase word flips to ENDED in place (page 19 `.xbtn`) and
 * the clock stops; the session leaves once ENDED has landed and been read.
 */
export const ENDED_SHOW_MS = 900

/**
 * Letting go of an early pull settles back (design-decisions "Timers"): the
 * beam sinks to nothing over this long, easing out, instead of vanishing.
 */
export const PULL_SETTLE_MS = 350

/** The beam `elapsedMs` into its settle from `from` (0..1): ease-out cubic down to 0. */
export function settlePull(from: number, elapsedMs: number, ms = PULL_SETTLE_MS): number {
  if (!(from > 0) || !(ms > 0)) return 0
  const t = Math.max(0, Math.min(1, elapsedMs / ms))
  return from * Math.pow(1 - t, 3)
}

// ─── combos ──────────────────────────────────────────────────

/** A combo's strikes, upper-cased: "Jab → Cross → Hook" → JAB, CROSS, HOOK. */
export function comboStrikes(text: string): string[] {
  return text
    .split(/\s*(?:→|›|->|>|,|·|\|)\s*/)
    .map(s => s.trim().toUpperCase())
    .filter(Boolean)
}

/** The letter for the n-th (0-based) combo: A..Z, then AA, AB… */
export function comboLetter(n: number): string {
  let i = Math.max(0, Math.floor(n))
  let out = ''
  do {
    out = String.fromCharCode(65 + (i % 26)) + out
    i = Math.floor(i / 26) - 1
  } while (i >= 0)
  return out
}

/** Each combo id gets a letter in order of first appearance; the same combo keeps its letter all session. */
export function comboLetters(ids: Iterable<string | null | undefined>): Map<string, string> {
  const map = new Map<string, string>()
  for (const id of ids) {
    if (!id || map.has(id)) continue
    map.set(id, comboLetter(map.size))
  }
  return map
}

// ─── closing ─────────────────────────────────────────────────

/** Page 19 #6: the word over the ten effort tiles. */
export const EFFORT_WORDS = ['VERY LIGHT', 'VERY LIGHT', 'LIGHT', 'LIGHT', 'MODERATE', 'MODERATE', 'HARD', 'HARD', 'VERY HARD', 'MAX EFFORT'] as const

export function effortWord(rpe: number): string {
  const i = Math.min(10, Math.max(1, Math.round(rpe))) - 1
  return EFFORT_WORDS[i]
}

/** The moment's line under WELL TRAVELED: "STRENGTH A · RPE 7". */
export function momentLine(sessionName: string, rpe: number): string {
  return `${sessionName.toUpperCase()} · RPE ${Math.round(rpe)}`
}
