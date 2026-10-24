// The hidden interval timer (page 81, approved): rounds, work and rest, pure.
//
// - A 10 s GET READY (teal), then per round WORK (gold) and REST (teal); the
//   last round has no rest, and a rest of 0:00 means no rest at all.
// - Orange near the end of each part: the last 10 s of work, the last 5 s of
//   rest and of get ready (the whole part when it is shorter), with a short
//   game beep each of those seconds.
// - A longer beep at each part change, then Poppy: "Get ready.", "Round N.",
//   "Rest.", "Last round.", and at the end the done chime and "Done.".
// - The setup window steps rounds by 1 (1 to 30), work and rest by 5 s under
//   a minute and 15 s from a minute up; work 0:05 to 10:00, rest 0:00 to 5:00.
// - The number pad types times like a microwave: 1 3 0 is 1:30.
// - It opens on the last numbers he started with (kept on the phone).
// Nothing here is ever logged.

export interface IntervalSetup {
  rounds: number
  /** Work per round, seconds. */
  work: number
  /** Rest between rounds, seconds (0: none). */
  rest: number
}

export type SetupKey = keyof IntervalSetup

export const LIMITS: Readonly<Record<SetupKey, readonly [number, number]>> = {
  rounds: [1, 30],
  work: [5, 600],
  rest: [0, 300],
}

/** The numbers the window opens on the first time. */
export const DEFAULT_SETUP: Readonly<IntervalSetup> = { rounds: 8, work: 30, rest: 15 }

export const GET_READY_SEC = 10

export type IntervalPhase = 'ready' | 'work' | 'rest'

/** How long the orange lasts at the end of each part (the whole part when it's shorter). */
export const WARN_SEC: Readonly<Record<IntervalPhase, number>> = { ready: 5, work: 10, rest: 5 }

export interface IntervalPart {
  ph: IntervalPhase
  /** Seconds. */
  len: number
  /** The round it belongs to (get ready: round 1, the one coming). */
  round: number
  /** Seconds from the start of the timer. */
  startSec: number
}

export function clampValue(key: SetupKey, v: number): number {
  const [lo, hi] = LIMITS[key]
  const n = Number.isFinite(v) ? Math.round(v) : lo
  return Math.max(lo, Math.min(hi, n))
}

export function clampSetup(s: Partial<IntervalSetup> | null | undefined): IntervalSetup {
  return {
    rounds: clampValue('rounds', s?.rounds ?? DEFAULT_SETUP.rounds),
    work: clampValue('work', s?.work ?? DEFAULT_SETUP.work),
    rest: clampValue('rest', s?.rest ?? DEFAULT_SETUP.rest),
  }
}

/** + : rounds by 1; times by 5 s under a minute, then by 15 s. */
export function stepUp(key: SetupKey, v: number): number {
  return clampValue(key, key === 'rounds' ? v + 1 : v < 60 ? v + 5 : v + 15)
}

/** − : rounds by 1; times by 15 s above a minute, then by 5 s. */
export function stepDown(key: SetupKey, v: number): number {
  return clampValue(key, key === 'rounds' ? v - 1 : v <= 60 ? v - 5 : v - 15)
}

/** "1:30", "0:05", "10:00"; from an hour up "1:02:03". */
export function mmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

/** A value on its flap: the rounds as a number, the times as m:ss (no blank tiles). */
export function valueText(key: SetupKey, v: number): string {
  return key === 'rounds' ? String(v) : mmss(v)
}

/** Every part in order: get ready, then work / rest per round (no rest after the last; rest 0 skips it). */
export function plan(s: IntervalSetup): IntervalPart[] {
  const parts: IntervalPart[] = [{ ph: 'ready', len: GET_READY_SEC, round: 1, startSec: 0 }]
  let at = GET_READY_SEC
  for (let r = 1; r <= s.rounds; r++) {
    parts.push({ ph: 'work', len: s.work, round: r, startSec: at })
    at += s.work
    if (r < s.rounds && s.rest > 0) {
      parts.push({ ph: 'rest', len: s.rest, round: r, startSec: at })
      at += s.rest
    }
  }
  return parts
}

/** The whole timer, seconds, the 10 s get ready included. */
export function totalSec(s: IntervalSetup): number {
  return GET_READY_SEC + s.rounds * s.work + Math.max(0, s.rounds - 1) * (s.rest > 0 ? s.rest : 0)
}

/** The plain line under the rows: "8 rounds · 6:10 total". */
export function totalLine(s: IntervalSetup): string {
  return `${s.rounds} round${s.rounds === 1 ? '' : 's'} · ${mmss(totalSec(s))} total`
}

/** Seconds of orange at the end of this part. */
export function warnLen(part: Pick<IntervalPart, 'ph' | 'len'>): number {
  return Math.min(WARN_SEC[part.ph], part.len)
}

export interface IntervalPosition {
  /** Index into plan(); the last part's index once done. */
  index: number
  part: IntervalPart
  /** Exact seconds left in the part. */
  left: number
  /** Whole seconds shown (rounded up: 0 only at the very end). */
  shown: number
  /** In the part's orange. */
  warn: boolean
  done: boolean
}

/** Where the timer is `elapsed` seconds in. */
export function positionAt(parts: IntervalPart[], elapsed: number): IntervalPosition {
  const last = parts[parts.length - 1]
  const end = last.startSec + last.len
  if (elapsed >= end) return { index: parts.length - 1, part: last, left: 0, shown: 0, warn: false, done: true }
  const t = Math.max(0, elapsed)
  let index = 0
  for (let i = parts.length - 1; i >= 0; i--) if (parts[i].startSec <= t) { index = i; break }
  const part = parts[index]
  const left = part.startSec + part.len - t
  const shown = Math.max(0, Math.ceil(left - 1e-9))
  return { index, part, left, shown, warn: shown > 0 && shown <= warnLen(part), done: false }
}

/** The phase word on the plate. */
export function phaseWord(ph: IntervalPhase): string {
  return ph === 'ready' ? 'GET READY' : ph === 'work' ? 'WORK' : 'REST'
}

/** DONE · 8 ROUNDS (DONE · 1 ROUND). */
export function doneWord(rounds: number): string {
  return `DONE · ${rounds} ROUND${rounds === 1 ? '' : 'S'}`
}

// ─── The sounds ────────────────────────────────────────────────

/** Poppy's clip as a part starts (public/cues, scripts/make-cues.py). */
export function partClip(part: IntervalPart, rounds: number): string {
  if (part.ph === 'ready') return 't_get_ready'
  if (part.ph === 'rest') return 't_rest'
  if (part.round === rounds && rounds > 1) return 't_last_round'
  return `t_round_${Math.max(1, Math.min(30, part.round))}`
}

export interface IntervalCue {
  /** Seconds from the start. */
  atSec: number
  kind: 'tick' | 'change' | 'done'
  clips: string[]
}

/**
 * Every sound, in order: the longer beep and Poppy at each part start, a short
 * beep each orange second (not on a part's first second: its change beep is
 * there), and the done chime with "Done." at the end. The native timer plays
 * this list by itself with the phone locked.
 */
export function cueSchedule(s: IntervalSetup): IntervalCue[] {
  const parts = plan(s)
  const out: IntervalCue[] = []
  for (const p of parts) {
    out.push({ atSec: p.startSec, kind: 'change', clips: ['t_change', partClip(p, s.rounds)] })
    const w = warnLen(p)
    for (let k = 0; k < w; k++) {
      const at = p.startSec + p.len - w + k
      if (at > p.startSec) out.push({ atSec: at, kind: 'tick', clips: ['t_tick'] })
    }
  }
  out.push({ atSec: totalSec(s), kind: 'done', clips: ['chime_done', 't_done'] })
  return out
}

// ─── The clock (wall time, pauses left out) ────────────────────

export interface IntervalClock {
  startedAtMs: number
  /** Paused: when. */
  pausedAtMs: number | null
  /** Time spent paused before now. */
  pausedMs: number
}

export function startClock(nowMs: number): IntervalClock {
  return { startedAtMs: nowMs, pausedAtMs: null, pausedMs: 0 }
}

export function pauseClock(c: IntervalClock, nowMs: number): IntervalClock {
  return c.pausedAtMs != null ? c : { ...c, pausedAtMs: nowMs }
}

export function resumeClock(c: IntervalClock, nowMs: number): IntervalClock {
  return c.pausedAtMs == null ? c : { ...c, pausedMs: c.pausedMs + Math.max(0, nowMs - c.pausedAtMs), pausedAtMs: null }
}

export function elapsedSec(c: IntervalClock, nowMs: number): number {
  const at = c.pausedAtMs ?? nowMs
  return Math.max(0, (at - c.startedAtMs - c.pausedMs) / 1000)
}

/** A clock that reads `elapsedMs` now (the native timer's word after the phone was locked). */
export function clockAt(elapsedMs: number, paused: boolean, nowMs: number): IntervalClock {
  return { startedAtMs: nowMs - Math.max(0, elapsedMs), pausedAtMs: paused ? nowMs : null, pausedMs: 0 }
}

// ─── The number pad ────────────────────────────────────────────

/** Digits the pad takes: rounds 2, times 4 (m m s s). */
export function padMax(key: SetupKey): number {
  return key === 'rounds' ? 2 : 4
}

/** A digit typed: no leading zero, no more than the field holds. */
export function padPush(key: SetupKey, buf: string, digit: string): string {
  if (!/^\d$/.test(digit)) return buf
  if (buf === '' && digit === '0') return buf
  if (buf.length >= padMax(key)) return buf
  return buf + digit
}

export function padBack(buf: string): string {
  return buf.slice(0, -1)
}

/** What the pad shows: the rounds typed, or the time as m:ss filling from the right. */
export function padShow(key: SetupKey, buf: string): string {
  if (key === 'rounds') return buf || '0'
  return `${buf.slice(0, -2) || '0'}:${buf.slice(-2).padStart(2, '0')}`
}

/** DONE: the typed value, kept inside the limits; null when nothing was typed (it stays as it was). */
export function padValue(key: SetupKey, buf: string): number | null {
  if (buf === '') return null
  const raw = key === 'rounds' ? Number(buf) : Number(buf.slice(0, -2) || '0') * 60 + Number(buf.slice(-2))
  return clampValue(key, raw)
}

// ─── The last numbers used ─────────────────────────────────────

export const LAST_KEY = 'wm.intervalTimer.last'

/** A saved setup, or null when there is none (or it can't be read). */
export function parseSaved(raw: string | null): IntervalSetup | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<IntervalSetup> | null
    if (!v || typeof v !== 'object') return null
    if (![v.rounds, v.work, v.rest].every(n => typeof n === 'number' && Number.isFinite(n))) return null
    return clampSetup(v)
  } catch {
    return null
  }
}

export function loadLast(get: (k: string) => string | null): IntervalSetup {
  return parseSaved(get(LAST_KEY)) ?? { ...DEFAULT_SETUP }
}

export function saveLast(set: (k: string, v: string) => void, s: IntervalSetup): void {
  set(LAST_KEY, JSON.stringify(clampSetup(s)))
}

// ─── Page 83: how the running timer reads ──────────────────────

/** The count under the clock: ROUND n (gold) at work, NEXT n (teal) resting or getting ready. */
export function countFor(pos: IntervalPosition, rounds: number): { label: 'ROUND' | 'NEXT'; n: number; tone: 'gold' | 'teal' } {
  if (pos.done) return { label: 'ROUND', n: rounds, tone: 'gold' }
  const { part } = pos
  if (part.ph === 'work') return { label: 'ROUND', n: part.round, tone: 'gold' }
  return { label: 'NEXT', n: part.ph === 'rest' ? Math.min(rounds, part.round + 1) : part.round, tone: 'teal' }
}

/** "NEXT · REST 0:15" while working into a rest; nothing resting, getting ready, or into another round. */
export function nextWords(parts: IntervalPart[], pos: IntervalPosition): string | null {
  if (pos.done || pos.part.ph !== 'work') return null
  const n = parts[pos.index + 1]
  return n && n.ph === 'rest' ? `NEXT · REST ${mmss(n.len)}` : null
}

/** The whole timer left ("4:06"), from `elapsed` seconds in. */
export function leftText(s: IntervalSetup, elapsed: number): string {
  return mmss(Math.max(0, Math.ceil(totalSec(s) - elapsed - 1e-9)))
}
