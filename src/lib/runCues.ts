// A hard run on the run screen and in the ear (page 76 §4 and §5, approved
// 2026-10-23). The plan's pieces become segments on the one run clock (the
// 5K test's 5 km lasts as long as he takes), each piece change becomes a cue
// (a game chime, then a short voice from the bundled clips: "Run hard. Speed
// twelve point eight." / outside "Pace four forty-one."), and outside, on the
// hard pieces only, the pace nudge watches the last 20 seconds.
//
// The native recorder plays the same cue list from the phone (locked, screen
// off, the show dipping under it); the web build plays it with HTMLAudio.
// Pure; relative imports only so the tests run it under node.

import type { HardPiece, HardPlan, PieceKind } from './brain/hardRuns'
import { numberClip, paceClip, paceSec, speedNumber, type TreadmillUnit } from './runSpeed'

export interface HardSegment {
  kind: PieceKind
  /** Run hard / jog: the rep (1-based); 0 otherwise. */
  round: number
  startSec: number
  /** Infinity for the test's 5 km while it is still going. */
  sec: number
  kmh: number
  /** The test's 5 km. */
  open: boolean
}

/**
 * The plan as segments on the run clock. The test's 5 km is open until
 * `testEndSec` (the clock when he finished the 5 km); after it, the cool-down
 * starts there.
 */
export function hardSegments(plan: Pick<HardPlan, 'pieces'>, testEndSec: number | null = null): HardSegment[] {
  const out: HardSegment[] = []
  let t = 0
  for (const p of plan.pieces) {
    const open = p.kind === 'test'
    const sec = open ? (testEndSec != null ? Math.max(1, testEndSec - t) : Infinity) : p.sec
    out.push({ kind: p.kind, round: p.round, startSec: t, sec, kmh: p.kmh, open })
    t += sec
  }
  return out
}

export interface HardPosition {
  index: number
  segment: HardSegment
  /** Seconds left in this piece (the test's open 5 km: seconds into it). */
  shownSec: number
  /** Counting up (the test's 5 km). */
  up: boolean
  done: boolean
}

export function hardAt(segments: HardSegment[], elapsedSec: number): HardPosition {
  const t = Math.max(0, elapsedSec)
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]
    if (t < s.startSec + s.sec) {
      return s.sec === Infinity
        ? { index: i, segment: s, shownSec: t - s.startSec, up: true, done: false }
        : { index: i, segment: s, shownSec: s.startSec + s.sec - t, up: false, done: false }
    }
  }
  const last = segments.length - 1
  return { index: last, segment: segments[last], shownSec: 0, up: false, done: true }
}

/** The big phase word: RUN HARD, EASY JOG, STEADY HARD, 5K, EASY. */
export function phaseWord(kind: PieceKind): string {
  switch (kind) {
    case 'hard': return 'RUN HARD'
    case 'jog': return 'EASY JOG'
    case 'steady': return 'STEADY HARD'
    case 'test': return '5K'
    default: return 'EASY'
  }
}

/** The phase flap's colour: gold for hard work, teal for easy. */
export function phaseTone(kind: PieceKind): 'gold' | 'teal' {
  return kind === 'hard' || kind === 'steady' || kind === 'test' ? 'gold' : 'teal'
}

/** "3 of 6" beside RUN HARD / EASY JOG (null on the other pieces). */
export function pieceOf(seg: HardSegment, reps: number): string | null {
  return (seg.kind === 'hard' || seg.kind === 'jog') && seg.round > 0 ? `${seg.round} of ${reps}` : null
}

/** NEXT, small: "easy jog 2:00", "run hard 2:00", "easy 5:00", "done". */
export function nextWords(segments: HardSegment[], index: number): string {
  const n = segments[index + 1]
  if (!n) return 'done'
  const word = phaseWord(n.kind).toLowerCase().replace('5k', '5 km')
  if (n.sec === Infinity || n.open) return word
  const m = Math.floor(n.sec / 60)
  return `${word} ${m}:${String(Math.round(n.sec % 60)).padStart(2, '0')}`
}

// ─── The cues ────────────────────────────────────────────────

export interface Cue {
  /** Run-clock second it plays at. */
  atSec: number
  /** The clips, in order (a chime first). */
  clips: string[]
  /** A buzz with it (piece changes and the finish). */
  buzz: boolean
}

const PHRASE: Readonly<Record<PieceKind, string>> = { hard: 'run_hard', jog: 'easy_jog', steady: 'steady_hard', test: 'five_k', easy: 'easy_run' }
const CHIME: Readonly<Record<PieceKind, string>> = { hard: 'chime_hard', jog: 'chime_jog', steady: 'chime_hard', test: 'chime_hard', easy: 'chime_jog' }

/** The words for one piece: indoors "Speed" and the number in his unit, outside "Pace" and the time per km (per mile with MPH). */
export function pieceClips(p: Pick<HardPiece, 'kind' | 'kmh'>, outdoor: boolean, unit: TreadmillUnit): string[] {
  const num = outdoor ? ['pace', paceClip(paceSec(p.kmh, unit))] : ['speed', numberClip(speedNumber(p.kmh, unit))]
  return [CHIME[p.kind], PHRASE[p.kind], ...num]
}

/**
 * Every cue of the run from `fromSec` on: each piece's start, three ticks in
 * the last 3 seconds of a timed piece, "Halfway." in a steady piece, and "Done.
 * Nice work." at the end. An open piece (the test's 5 km) stops the list: the
 * rest is sent again once it ends.
 */
export function hardCues(segments: HardSegment[], outdoor: boolean, unit: TreadmillUnit): Cue[] {
  const out: Cue[] = []
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]
    out.push({ atSec: s.startSec, clips: pieceClips(s, outdoor, unit), buzz: true })
    if (s.sec === Infinity) return out
    if (s.kind === 'steady' && s.sec >= 240) out.push({ atSec: s.startSec + Math.round(s.sec / 2), clips: ['chime_nudge', 'halfway'], buzz: false })
    if (i < segments.length - 1 && s.sec >= 20) out.push({ atSec: s.startSec + s.sec - 3, clips: ['ticks'], buzz: false })
  }
  const last = segments[segments.length - 1]
  if (last && last.sec !== Infinity) out.push({ atSec: last.startSec + last.sec, clips: ['chime_done', 'done'], buzz: true })
  return out.sort((a, b) => a.atSec - b.atSec)
}

/** The cue clock: the latest cue due at `clockSec` not played yet (one late by more than 3 s is let go). */
export function dueCue(cues: readonly Cue[], played: ReadonlySet<number>, clockSec: number): { cue: Cue; index: number } | null {
  let due: { cue: Cue; index: number } | null = null
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i]
    if (played.has(i) || c.atSec > clockSec) continue
    if (clockSec - c.atSec > 3) continue
    if (!due || c.atSec >= due.cue.atSec) due = { cue: c, index: i }
  }
  return due
}

// ─── Outdoor pace nudges (hard pieces only) ──────────────────

export const NUDGE_WINDOW_SEC = 20
export const NUDGE_OFF_SEC_KM = 10
export const NUDGE_COOLDOWN_SEC = 60
export const NUDGE_FIRST_SEC = 60
/** A new piece settles this long before its 20-second window starts. */
export const NUDGE_SETTLE_SEC = 10

export interface NudgeState {
  /** [clockSec, distM] samples, the last ~25 s. */
  samples: Array<[number, number]>
  lastAt: number | null
}

export const NUDGE_START: NudgeState = { samples: [], lastAt: null }

export type Nudge = 'fast' | 'slow'

/**
 * One GPS sample on the run clock. Outside, on a run-hard or steady-hard piece,
 * when the last 20 s ran more than 10 s/km off the piece's pace: 'fast' or
 * 'slow'. Never in the run's first minute, never in a piece's first 30 s, at
 * most once a minute. Easy pieces never nudge (his heart guides those).
 */
export function stepNudge(state: NudgeState, at: { clockSec: number; distM: number; segment: HardSegment | null; outdoor: boolean }): { state: NudgeState; nudge: Nudge | null } {
  const samples = [...state.samples, [at.clockSec, at.distM] as [number, number]].filter(([t]) => at.clockSec - t <= NUDGE_WINDOW_SEC + 5)
  const next: NudgeState = { samples, lastAt: state.lastAt }
  const seg = at.segment
  if (!at.outdoor || !seg || (seg.kind !== 'hard' && seg.kind !== 'steady') || !(seg.kmh > 0)) return { state: next, nudge: null }
  if (at.clockSec < NUDGE_FIRST_SEC) return { state: next, nudge: null }
  const windowStart = at.clockSec - NUDGE_WINDOW_SEC
  if (windowStart < seg.startSec + NUDGE_SETTLE_SEC) return { state: next, nudge: null }
  if (state.lastAt != null && at.clockSec - state.lastAt < NUDGE_COOLDOWN_SEC) return { state: next, nudge: null }
  const first = samples.find(([t]) => t >= windowStart)
  if (!first || at.clockSec - first[0] < NUDGE_WINDOW_SEC - 1) return { state: next, nudge: null }
  const dKm = (at.distM - first[1]) / 1000
  const dt = at.clockSec - first[0]
  if (!(dKm > 0.02)) return { state: next, nudge: null }
  const pace = dt / dKm
  const target = 3600 / seg.kmh
  const off = pace - target
  if (Math.abs(off) <= NUDGE_OFF_SEC_KM) return { state: next, nudge: null }
  return { state: { samples, lastAt: at.clockSec }, nudge: off < 0 ? 'fast' : 'slow' }
}

/** The nudge's clips: "A bit fast. Ease to four forty-one." / "Pick it up a little. Four forty-one." */
export function nudgeClips(n: Nudge, kmh: number, unit: TreadmillUnit): string[] {
  return ['chime_nudge', n === 'fast' ? 'fast' : 'slow', paceClip(paceSec(kmh, unit))]
}

/** What the screen says under PACE for a few seconds: A BIT FAST · ease to 4:41 / PICK IT UP · to 4:41. */
export function nudgeWord(n: Nudge): { flap: string; to: string } {
  return n === 'fast' ? { flap: 'A BIT FAST', to: 'ease to' } : { flap: 'PICK IT UP', to: 'to' }
}

/** The nudge targets for the recorder: the hard pieces with their speeds (open ones end at Infinity). */
export function nudgeTargets(segments: HardSegment[]): Array<{ fromSec: number; toSec: number; kmh: number }> {
  return segments.filter(s => s.kind === 'hard' || s.kind === 'steady').map(s => ({ fromSec: s.startSec, toSec: s.startSec + s.sec, kmh: s.kmh }))
}
